/**
 * Kế hoạch kết nối lại cho listener zca-js. Tách THUẦN (không đụng đồng hồ/mạng
 * thật) để test tất định.
 *
 * VÌ SAO CÓ - ca thật (2026-08-25): người dùng ĐỔI MẬT KHẨU Zalo -> Zalo thu hồi
 * MỌI phiên -> cookie web của bot chết -> listener nối websocket được ("đã kết
 * nối") nhưng bị Zalo từ chối phiên ngay (~2ms) -> đóng -> reconnect bằng đúng
 * cookie chết -> LẶP VÔ TẬN mỗi ~1.8s. Bản cũ `onConnected` reset backoff ngay
 * cả khi vừa nối 2ms, nên bão không bao giờ lùi -> spam log + RỦI RO Zalo gắn cờ
 * nick (ràng buộc #1 của dự án), mà người vận hành không có tín hiệu nào để biết
 * là "phiên hết hạn, cần re-login".
 *
 * Hai sửa chốt:
 * 1. CHỈ reset backoff khi kết nối ĐỨNG đủ lâu (`onDinhMs`). Nối chớp-tắt tính là
 *    thất bại -> backoff LÙI DẦN tới trần. Mạng chớp trên một kết nối lành thì
 *    vẫn reconnect nhanh; còn bão chớp-tắt (phiên chết) thì giãn ra.
 * 2. Đếm số lần chớp-tắt LIÊN TIẾP; quá ngưỡng thì bật cờ nghi phiên chết để
 *    caller log cảnh báo "cần đăng nhập lại".
 */

/** Nối ngắn hơn mốc này coi là chớp-tắt (phiên chết/bị đá); dài hơn là lành */
const ON_DINH_MS = 5_000;
const BACKOFF_CO_SO_MS = 1_000;
const BACKOFF_TRAN_MS = 60_000;
/** Bao nhiêu lần chớp-tắt LIÊN TIẾP thì nghi phiên hết hạn (khuyên re-login) */
const NGUONG_NGHI_NGO = 5;

export type KetQuaDong = {
  /** Chờ bao lâu rồi hãy kết nối lại (đã cộng jitter) */
  delayMs: number;
  /** Kết nối vừa rồi có ĐỨNG đủ lâu không (lành) */
  onDinh: boolean;
  /** Số lần nối-rồi-rớt-ngay LIÊN TIẾP tính tới hiện tại */
  chopTatLienTiep: number;
  /** Đã đủ ngưỡng để nghi phiên hết hạn -> caller nên khuyên re-login */
  nghiNgoPhienChet: boolean;
};

export class KeHoachKetNoiLai {
  private soLan = 0;
  private chopTatLienTiep = 0;
  private ketNoiLuc: number | null = null;

  private readonly onDinhMs: number;
  private readonly coSoMs: number;
  private readonly tranMs: number;
  private readonly nguongNghiNgo: number;

  constructor(
    opts: { onDinhMs?: number; coSoMs?: number; tranMs?: number; nguongNghiNgo?: number } = {},
  ) {
    this.onDinhMs = opts.onDinhMs ?? ON_DINH_MS;
    this.coSoMs = opts.coSoMs ?? BACKOFF_CO_SO_MS;
    this.tranMs = opts.tranMs ?? BACKOFF_TRAN_MS;
    this.nguongNghiNgo = opts.nguongNghiNgo ?? NGUONG_NGHI_NGO;
  }

  /** Gọi khi listener báo đã kết nối. `now` do caller cấp (Date.now() thật). */
  danhDauKetNoi(now: number): void {
    this.ketNoiLuc = now;
  }

  /**
   * Gọi khi listener đóng. `jitter` (>= 0) do caller cấp để test tất định.
   * Trả kế hoạch chờ + cờ nghi phiên chết.
   */
  danhDauDong(now: number, jitter: number): KetQuaDong {
    const onDinh = this.ketNoiLuc !== null && now - this.ketNoiLuc >= this.onDinhMs;
    if (onDinh) {
      // Kết nối lành vừa rớt (mạng chớp) -> khởi động lại nhanh, quên chuỗi chớp-tắt.
      this.soLan = 0;
      this.chopTatLienTiep = 0;
    } else {
      this.chopTatLienTiep += 1;
    }
    // Tiêu một lần kết nối: lần đóng kế tiếp mà không có kết nối mới xen giữa thì
    // KHÔNG được tính nhầm là "đứng" theo mốc cũ.
    this.ketNoiLuc = null;

    const backoff = Math.min(this.tranMs, this.coSoMs * 2 ** this.soLan);
    const delayMs = backoff + jitter;
    this.soLan += 1;

    return {
      delayMs,
      onDinh,
      chopTatLienTiep: this.chopTatLienTiep,
      nghiNgoPhienChet: this.chopTatLienTiep >= this.nguongNghiNgo,
    };
  }
}
