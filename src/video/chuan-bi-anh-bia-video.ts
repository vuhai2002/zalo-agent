/**
 * Dựng POSTER cho video: tải ảnh bìa NGUỒN về RAM rồi UPLOAD lên Zalo, trả về
 * URL ảnh trên hạ tầng Zalo. Không dựng được thì trả `null` - caller lùi sang
 * GỬI DẠNG FILE (không cần poster).
 *
 * VÌ SAO PHẢI UPLOAD chứ không đưa thẳng URL nguồn - đo thật tới điện thoại:
 *
 *   thumbnailUrl = URL TikTok/Facebook  -> thẻ video hiện ĐEN THUI (Zalo kén host ảnh)
 *   thumbnailUrl = "" (rỗng)            -> Zalo TỪ CHỐI: ZaloApiError code 114
 *   thumbnailUrl = ảnh đã upload lên Zalo -> poster hiện ĐÚNG
 *
 * VÌ SAO KHÔNG DÙNG `parseLink` nữa: đo thật trên link Facebook, `parseLink` trả
 * một URL `zadn.vn` nhưng nó là ảnh PLACEHOLDER chung ("feed_thumb_link" từ
 * 2019), không phải khung hình video - đúng cái poster hỏng người dùng thấy. Nó
 * LOAD được nên "kiểm ảnh có load" không bắt được. Người dùng chốt: thà gửi file
 * còn hơn hiện placeholder nhìn rẻ.
 *
 * VÌ SAO KHÔNG TRÍCH KHUNG TẠI CHỖ: cần giải mã H.264 trên byte của người lạ -
 * Node không có WebCodecs, decoder thuần JS chỉ Baseline (TikTok/FB dùng
 * Main/High) và đã bỏ hoang, mọi "WebCodecs cho Node" trên npm đều là ffmpeg đội
 * lốt. Đúng mặt tấn công thiết kế này tránh (lý do không cài ffmpeg).
 *
 * KHÔNG chạm đĩa: ảnh đi thẳng vào RAM rồi lên Zalo, cỡ vài chục KB.
 */

import type { API, ThreadType } from "zca-js";

import { downloadFromPublicUrl } from "../shared/safe-remote-download.js";
import { createLogger } from "../shared/logger.js";
import { readImageSize } from "../zalo/zalo-image-variant.js";

const log = createLogger("anh-bia-video");

/**
 * Trần cỡ ảnh bìa. Ảnh bìa thật vài chục KB; 5MB là trần rộng chỉ để chặn một
 * URL nguồn độc trỏ tới file khổng lồ, không phải để lọc ảnh thật.
 */
const TRAN_ANH_BYTE = 5 * 1024 * 1024;

export type DichAnhBia = { api: API; threadId: string; threadType: ThreadType };

/** Chỗ chạm mạng, thay được CHỈ để test */
export type PhuThuocAnhBia = {
  taiAnh: (url: string, maxBytes: number) => Promise<Buffer | null>;
};

async function taiAnhMacDinh(url: string, maxBytes: number): Promise<Buffer | null> {
  try {
    // Qua `downloadFromPublicUrl` để thừa hưởng gác SSRF: URL ảnh bìa cũng do
    // bên thứ ba trả về nên không được tin hơn URL video.
    const { data } = await downloadFromPublicUrl(url, { maxBytes });
    return data.length > 0 ? data : null;
  } catch (err) {
    log.debug({ err }, "tải ảnh bìa nguồn hỏng");
    return null;
  }
}

const PHU_THUOC_THAT: PhuThuocAnhBia = { taiAnh: taiAnhMacDinh };

/**
 * Trả URL poster trên hạ tầng Zalo, hoặc `null` nếu không dựng được.
 *
 * `null` KHÔNG phải lỗi - nó là tín hiệu cho caller lùi sang gửi dạng file. Mọi
 * nhánh hỏng đều về `null`, không ném: mất poster thì còn gửi file được, ném là
 * mất cả video.
 */
export async function chuanBiAnhBiaVideo(
  dich: DichAnhBia,
  thumbnailNguon: string,
  phuThuoc: PhuThuocAnhBia = PHU_THUOC_THAT,
): Promise<string | null> {
  if (thumbnailNguon === "") return null;

  const buf = await phuThuoc.taiAnh(thumbnailNguon, TRAN_ANH_BYTE);
  if (!buf) return null;

  // Đọc kích thước bằng byte, KHÔNG giải mã ảnh. `uploadAttachment` cần
  // width/height cho nhánh ảnh; đọc không ra (vd WebP) thì bỏ, lùi sang gửi file.
  //
  // Guard này TRÌNH BIÊN DỊCH canh, không phải unit test: `co` là nullable nên
  // bỏ nó đi là lỗi type ngay dòng `co.width` dưới. Phép phá qua tsx (bỏ
  // typecheck) không làm test đỏ vì `try/catch` cũng nuốt cùng ra `null` - hai
  // lớp cùng một kết cục, giữ guard vì nó cho log rõ và bỏ sớm trước network.
  const co = readImageSize(buf);
  if (!co) {
    log.debug({ bytes: buf.length }, "không đọc được kích thước ảnh bìa - lùi sang gửi file");
    return null;
  }

  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const up = (await (dich.api as any).uploadAttachment(
      [{ data: buf, filename: "cover.jpg", metadata: { totalSize: buf.length, width: co.width, height: co.height } }],
      dich.threadId,
      dich.threadType,
    )) as unknown;

    const r = (Array.isArray(up) ? up[0] : up) as
      | { normalUrl?: string; hdUrl?: string; thumbUrl?: string }
      | undefined;
    const url = r?.normalUrl ?? r?.hdUrl ?? r?.thumbUrl ?? "";
    return url === "" ? null : url;
  } catch (err) {
    log.debug({ err }, "upload ảnh bìa lên Zalo hỏng - lùi sang gửi file");
    return null;
  }
}
