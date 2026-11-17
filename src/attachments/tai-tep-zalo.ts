import { downloadFromPublicUrl, LoiTaiVe } from "../shared/safe-remote-download.js";

/**
 * Tải byte một tệp người dùng gửi qua Zalo (`content.href` của `share.file`)
 * vào RAM. Không cookie: kho lưu trữ thật tải được 990 tệp bằng GET trơn,
 * OpenClaw/goclaw cũng vậy.
 *
 * `href` do client người gửi tự khai nên CHỈ cho tải từ CDN Zalo, chỉ https,
 * kiểm ở MỌI hop chuyển hướng (host lấy từ dữ liệu thật: `*.dlfl.vn`,
 * `*.zdn.vn`; thêm `flchat.vn`/`dlmd.me`/`zadn.vn` theo OpenClaw và kho lưu
 * trữ). Không bao giờ log `href` - ai có link là tải được tệp.
 */

export const HOST_TEP_ZALO = ["zdn.vn", "zadn.vn", "dlfl.vn", "flchat.vn", "dlmd.me"] as const;

/** Hạn chót tổng cho một lần tải tệp - trần idle không bắt được nguồn nhỏ giọt */
const HAN_TONG_TAI_MS = 60_000;
/** Thân trả lời nhỏ hơn mức này mới được xét là trang báo lỗi của CDN */
const TRAN_THAN_BAO_LOI = 2048;
const DAU_HIEU_HET_HAN = /expired|invalid signature/i;

export type KetQuaTaiTep = { ok: true; buf: Buffer } | { ok: false; ma: "het-han" | "qua-lon" | "host-la" | "mang" };

/** Tệp chữ thật có thể chứa chữ "expired" - không đoán trang lỗi CDN với các đuôi này */
const DUOI_CHU = new Set(["txt", "csv", "md", "json", "log", "tsv"]);

export async function taiTepZalo(
  href: string,
  maxBytes: number,
  fetcher: typeof downloadFromPublicUrl = downloadFromPublicUrl,
  duoiKhai = "",
): Promise<KetQuaTaiTep> {
  try {
    const tep = await fetcher(href, {
      maxBytes,
      hostDuocPhep: HOST_TEP_ZALO,
      chiHttps: true,
      hanTongMs: HAN_TONG_TAI_MS,
    });
    // Link chết có khi trả 200 kèm một mẩu JSON/chữ báo lỗi thay vì 403 (đo ở
    // kho lưu trữ) - nhận diện theo cỡ + loại + nội dung, không chỉ theo chữ
    const laChu = /json|text/i.test(tep.mediaType);
    const coTheLaTrangLoi = laChu && !DUOI_CHU.has(duoiKhai.toLowerCase()) && tep.data.length <= TRAN_THAN_BAO_LOI;
    if (coTheLaTrangLoi && DAU_HIEU_HET_HAN.test(tep.data.toString("utf-8"))) {
      return { ok: false, ma: "het-han" };
    }
    return { ok: true, buf: tep.data };
  } catch (err) {
    if (err instanceof LoiTaiVe) {
      if (err.ma === "http" && (err.status === 403 || err.status === 404 || err.status === 410)) return { ok: false, ma: "het-han" };
      // 200 mà 0 byte: CDN chưa có / đã xóa tệp
      if (err.ma === "rong") return { ok: false, ma: "het-han" };
      if (err.ma === "qua-lon") return { ok: false, ma: "qua-lon" };
      if (err.ma === "host-la") return { ok: false, ma: "host-la" };
    }
    return { ok: false, ma: "mang" };
  }
}
