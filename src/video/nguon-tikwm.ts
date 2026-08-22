/**
 * Nguồn CHÍNH cho TikTok: API công khai của tikwm.com.
 *
 * VÌ SAO ĐỨNG TRƯỚC yt-dlp - số đo cùng IP, cùng khung giờ (2026-08-22):
 *
 *   TikWM   12/12 (100%)   1,04 giây   trả h264
 *   yt-dlp   3/7  (~43%)   3,94 giây   trả h265 (mặc định)
 *
 * yt-dlp hỏng vì TikTok trả trang thử thách chống bot. Đã thử 4 cách chữa
 * (`--impersonate`, `api_hostname`, `device_id`, thử lại) đều không kéo nổi tỉ
 * lệ lên. TikWM đứng ngoài chuyện đó vì họ tự lo phần chống bot.
 *
 * ĐỔI LẠI: đây là dịch vụ MIỄN PHÍ của bên thứ ba. Nó có thể sập, thu phí, hay
 * siết giới hạn bất cứ lúc nào - nên yt-dlp vẫn phải ở lại làm tầng 2. Và link
 * người dùng gửi có đi qua máy chủ của họ (họ biết ai tra video nào, không lộ
 * nội dung tin nhắn).
 *
 * KHÔNG hỗ trợ Facebook - đo được `Url parsing is failed`. Facebook đi yt-dlp.
 */

import { CO_MAC_DINH, type KetQuaNguon } from "./thong-tin-video.js";

const API = "https://www.tikwm.com/api/";

/**
 * Trần thời gian một lời gọi.
 *
 * Đo thật 1,04 giây, nên 20 giây là rộng rãi. Có trần vì `fetch` không tự bỏ
 * cuộc: dịch vụ treo mà không có `AbortSignal` thì lời gọi này giữ luôn một
 * suất trong hàng đợi song song (chỉ có 2 suất) cho tới hết lượt agent.
 */
const TRAN_MS = 20_000;

/**
 * Hình dạng phần `data` mà TikWM trả về.
 *
 * Khai lỏng (mọi trường `unknown`) rồi tự kiểm từng cái: đây là JSON từ bên
 * thứ ba, khai chặt rồi ép kiểu là tự lừa mình - họ đổi một trường là ta đọc
 * `undefined` mà trình biên dịch vẫn im.
 */
type DataTho = Record<string, unknown>;

function soHoacNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function chuoiHoacNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function layVideoTuTikwm(url: string): Promise<KetQuaNguon> {
  let json: unknown;
  try {
    const res = await fetch(`${API}?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(TRAN_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      // 5xx là phía họ, thử lại có nghĩa. 4xx là ta gửi sai, thử lại vô ích.
      return { ok: false, loi: `TikWM trả HTTP ${res.status}`, thuLaiDuoc: res.status >= 500 };
    }
    json = await res.json();
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e);
    return { ok: false, loi: `Không gọi được TikWM: ${loi}`, thuLaiDuoc: true };
  }

  const goc = json as Record<string, unknown> | null;
  if (!goc || typeof goc !== "object") {
    return { ok: false, loi: "TikWM trả dữ liệu không đọc được", thuLaiDuoc: true };
  }

  if (goc.code !== 0) {
    const msg = chuoiHoacNull(goc.msg) ?? "không rõ lý do";
    // "Free Api Limit: 1 request/second" - đo thật khi gọi liên tiếp không nghỉ.
    // Đây là ca THỬ LẠI ĐƯỢC, khác hẳn "url sai" vốn thử mãi cũng vậy.
    const chamToc = /limit/i.test(msg);
    return { ok: false, loi: `TikWM từ chối: ${msg}`, thuLaiDuoc: chamToc };
  }

  const d = (goc.data ?? {}) as DataTho;

  // `play` là bản KHÔNG watermark, `wmplay` là bản CÓ. Đã kiểm bằng mắt trên
  // khung hình giây 5 và giây 20 của cùng một video: `wmplay` có logo TikTok +
  // @username và logo DI CHUYỂN theo thời gian, `play` sạch. Hai file lệch nhau
  // 833.225 byte. Lấy nhầm trường là hỏng đúng thứ người dùng cần.
  const videoUrl = chuoiHoacNull(d.play);
  if (!videoUrl) {
    return { ok: false, loi: "TikWM không trả đường dẫn video", thuLaiDuoc: true };
  }

  const giay = soHoacNull(d.duration);

  return {
    ok: true,
    video: {
      videoUrl,
      // `cover` thiếu thì dùng `origin_cover`; vẫn thiếu thì để rỗng và tầng
      // trên tự quyết - `sendVideo` đòi trường này nhưng chuỗi rỗng còn hơn là
      // ném cả lượt đi vì thiếu một cái ảnh bìa.
      thumbnailUrl: chuoiHoacNull(d.cover) ?? chuoiHoacNull(d.origin_cover) ?? "",
      // TikWM trả GIÂY, `sendVideo` cần MILI GIÂY.
      durationMs: giay === null ? 0 : Math.round(giay * 1000),
      // TikWM không trả kích cỡ khung hình. Đo thật: video của họ là 576x1024,
      // đúng bằng mặc định dọc.
      width: CO_MAC_DINH.width,
      height: CO_MAC_DINH.height,
      fileSize: soHoacNull(d.size),
      // Cắt ngay tại nguồn - xem chú thích cùng chỗ ở `nguon-yt-dlp.ts`.
      tacGia: chuoiHoacNull((d.author as DataTho | undefined)?.unique_id)?.slice(0, 64) ?? null,
      nguon: "tikwm",
      nenTang: "tiktok",
    },
  };
}
