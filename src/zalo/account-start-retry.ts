import { ZaloApiError } from "zca-js";
import { createLogger } from "../shared/logger.js";

/**
 * Tự thử khởi động lại account khi lần khởi động hỏng vì LỖI MẠNG TẠM THỜI.
 *
 * Ca thật 2026-11-19: DNS của VPS chết vài phút, tiến trình crash và container
 * restart. Lúc boot DNS VẪN chết, `loginWithStoredCredentials` ném
 * `TypeError: fetch failed` (cause `EAI_AGAIN`), `startAllAccounts` log "bỏ qua"
 * rồi không ai hẹn thử lại - account cá nhân nằm im hơn 30 tiếng dù mạng lành
 * ngay sau đó vài phút. Tài khoản bot thì sống vì `chayTaiKhoanBot` đã chịu lỗi
 * mạng từ trước (xem chú thích ở đó) - đây là mảnh tương ứng cho kênh cá nhân.
 */

const log = createLogger("account-start-retry");

const CHO_CO_SO_MS = 30_000;
const CHO_TRAN_MS = 5 * 60_000;

/**
 * Lỗi đăng nhập có đáng thử lại không.
 *
 * Dựa vào HÌNH DẠNG lỗi của `loginCookie` (zca-js 2.2.0, `zalo.js` + `apis/login.js`):
 * kiểu lỗi + ĐÚNG một thông điệp cố định của undici, không dò chữ tự do:
 * - Mạng hỏng: mọi lời gọi của zca-js đi qua `fetch`, và nó ném NGUYÊN lỗi đó -
 *   undici LUÔN là `TypeError("fetch failed")`, nguyên nhân thật (`EAI_AGAIN`,
 *   `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`...) nằm ở `cause`. -> thử lại.
 *   Không lập bảng mã `cause.code`: đã thử, phá bảng đi mà mọi ca vẫn xanh vì
 *   không có đường nào ném lỗi mạng ngoài hình dạng trên - bảng chỉ là code chết.
 * - Phiên chết / cookie hỏng / thiếu tham số: `ZaloApiError`. -> KHÔNG thử: chờ
 *   bao lâu cũng không tự hết, phải quét QR lại; thử mãi chỉ thêm rủi ro Zalo
 *   gắn cờ nick. `ZaloApiError` bọc cả phản hồi HTTP không-OK (kể cả 5xx) - chấp
 *   nhận bỏ sót ca 5xx thay vì dò chữ `statusText` để tách 5xx khỏi 4xx.
 * - Thiếu credential (lỗi `Error` thường của mình) -> KHÔNG thử.
 * Cùng luật với `laLoiMatKetNoiMcp` (`mcp-transport-failure.ts`).
 */
export function laLoiMangTamThoi(err: unknown): boolean {
  if (err instanceof ZaloApiError) return false;
  return err instanceof TypeError && err.message === "fetch failed";
}

/** Chờ trước lần thử thứ `lan` (0-based): 30s, 1m, 2m, 4m, rồi giữ 5m */
export function choTruocLanThu(lan: number, coSoMs = CHO_CO_SO_MS, tranMs = CHO_TRAN_MS): number {
  return Math.min(coSoMs * 2 ** lan, tranMs);
}

export type PhuThuocHenKhoiDong = {
  /** Khởi động account; ném nếu hỏng */
  thuKhoiDong: (accountId: string) => Promise<void>;
  /**
   * Còn nên thử không - đọc LẠI trạng thái ngay lúc timer nổ: account có thể đã
   * bị xóa, bị tắt, hoặc đã chạy nhờ người vận hành quét QR / gạt nút.
   */
  nenThu: (accountId: string) => boolean;
  coSoMs?: number;
  tranMs?: number;
};

/** Sổ hẹn thử lại, mỗi account tối đa MỘT hẹn đang chờ */
export class HenKhoiDongLai {
  private readonly hen = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly phuThuoc: PhuThuocHenKhoiDong) {}

  /** Hẹn lần thử thứ `lan`. Hẹn cũ của cùng account (nếu có) bị thay. */
  henThu(accountId: string, lan = 0): void {
    this.huy(accountId);
    const choMs = choTruocLanThu(lan, this.phuThuoc.coSoMs, this.phuThuoc.tranMs);
    log.warn({ accountId, lanThu: lan + 1, choMs }, "Khởi động account hỏng vì lỗi mạng - sẽ tự thử lại");
    const timer = setTimeout(() => {
      this.hen.delete(accountId);
      void this.chayLanThu(accountId, lan);
    }, choMs);
    // Timer chờ không được giữ tiến trình sống (shutdown, test) - lúc chạy thật
    // thì dashboard + scheduler đã giữ event loop rồi.
    timer.unref();
    this.hen.set(accountId, timer);
  }

  huy(accountId: string): void {
    const timer = this.hen.get(accountId);
    if (!timer) return;
    clearTimeout(timer);
    this.hen.delete(accountId);
  }

  huyHet(): void {
    for (const id of [...this.hen.keys()]) this.huy(id);
  }

  dangHen(accountId: string): boolean {
    return this.hen.has(accountId);
  }

  private async chayLanThu(accountId: string, lan: number): Promise<void> {
    if (!this.phuThuoc.nenThu(accountId)) {
      log.info({ accountId }, "Bỏ lượt thử lại: account đã chạy, đã tắt hoặc đã xóa");
      return;
    }
    try {
      await this.phuThuoc.thuKhoiDong(accountId);
      log.info({ accountId, lanThu: lan + 1 }, "Thử lại khởi động account thành công");
    } catch (err) {
      if (laLoiMangTamThoi(err)) {
        this.henThu(accountId, lan + 1);
        return;
      }
      log.error({ accountId, err }, "Thử lại khởi động account hỏng vì lỗi không phải mạng - dừng thử");
    }
  }
}
