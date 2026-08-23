/**
 * Xin Zalo một ảnh bìa nằm trên CDN của chính họ.
 *
 * VÌ SAO: `sendVideo` cần `thumbnailUrl`, và đưa nó một URL của TikTok/Facebook
 * thì thẻ video hiện ĐEN THUI - tài liệu dự án đã ghi Zalo rất kén host ảnh
 * (`upload.wikimedia.org` bị từ chối thẳng với câu "The photo URL is invalid").
 *
 * Chỗ lấy: chính API `parselink` mà Zalo dùng để dựng thẻ xem trước khi NGƯỜI
 * DÙNG dán một link vào chat. Máy chủ Zalo tự đi lấy ảnh bìa rồi tự lưu, nên ta
 * xin lại được một URL `photo-link-talk.zadn.vn` mà KHÔNG phải upload gì, KHÔNG
 * tốn byte nào.
 *
 * ĐO THẬT trên link TikTok của người dùng:
 *   thumb = https://photo-link-talk.zadn.vn/photolinkv2/720/zlv2...
 *
 * KHÔNG NÉM: ảnh bìa là thứ làm cho đẹp, không phải điều kiện để gửi. Hỏng thì
 * trả `null` và caller dùng ảnh bìa của nguồn - xấu hơn nhưng vẫn gửi được.
 */

import type { API } from "zca-js";

import { createLogger } from "../shared/logger.js";

const log = createLogger("anh-bia-zalo");

/** Trần thời gian - đây là bước làm đẹp, không đáng để nó giữ một suất song song lâu */
const TRAN_MS = 15_000;

/** Host ảnh của Zalo. Chỉ nhận ảnh nằm trên hạ tầng của họ. */
function cuaZalo(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "zadn.vn" || h.endsWith(".zadn.vn");
  } catch {
    return false;
  }
}

/**
 * Lấy ảnh bìa Zalo cho `urlGoc` (đường dẫn NGƯỜI DÙNG gửi, không phải URL CDN).
 *
 * Trả `null` khi không lấy được, hoặc khi Zalo trả về một URL không nằm trên hạ
 * tầng của họ - lúc đó nó chẳng hơn gì ảnh bìa ta đã có sẵn.
 */
export async function layAnhBiaZalo(api: API, urlGoc: string): Promise<string | null> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const goi = (api as any).parseLink(urlGoc) as Promise<{ data?: { thumb?: string } }>;
    const ket = await Promise.race([
      goi,
      new Promise<never>((_, hong) =>
        setTimeout(() => hong(new Error(`parseLink quá ${TRAN_MS}ms`)), TRAN_MS).unref(),
      ),
    ]);

    const thumb = ket?.data?.thumb;
    if (typeof thumb !== "string" || thumb === "") return null;
    if (!cuaZalo(thumb)) {
      log.debug({ thumb: thumb.slice(0, 80) }, "parseLink trả ảnh bìa không nằm trên host Zalo");
      return null;
    }
    return thumb;
  } catch (err) {
    log.debug({ err }, "không xin được ảnh bìa từ Zalo - dùng ảnh bìa của nguồn");
    return null;
  }
}
