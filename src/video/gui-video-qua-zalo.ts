/**
 * Ba đường gửi video qua Zalo, chọn theo KẾT QUẢ DÒ chứ không theo phỏng đoán.
 *
 *   DÒ (`kiemUrlVideoConSong`): HEAD có gác, kiểm địa chỉ + status + kiểu nội dung
 *     |
 *     +-- dò QUA  -> ĐƯỜNG 1: `sendVideo({videoUrl})`. Máy NGƯỜI NHẬN tải,
 *     |               0 byte qua VPS. Nếu chính lời gọi này ném thì
 *     |               -> ĐƯỜNG 2: tự tải URL (đã biết là sống) rồi upload.
 *     |
 *     +-- dò TRƯỢT -> ĐƯỜNG 3: để yt-dlp TỰ TẢI từ URL GỐC của người dùng.
 *
 * VÌ SAO PHẢI DÒ TRƯỚC - đây là lỗi đã trả giá:
 *
 * Bản trước gọi thẳng `sendVideo` rồi trông vào `catch` để lùi sang đường tải.
 * Nhưng `sendVideo` KHÔNG ném khi URL trả 403/404 (zca-js `sendVideo.ts:69-77`:
 * `if (headResponse.ok)`), nó vẫn gửi tin chứa URL chết. Nên `catch` không bao
 * giờ chạy, đường tải là code chết, và bot báo "đã gửi" cho một video hỏng.
 *
 * VÌ SAO ĐƯỜNG 3 KHÔNG GỘP ĐƯỢC VÀO ĐƯỜNG 2 - số đo trên link TikTok thật:
 * URL của yt-dlp trả **403 ngay trên chính máy vừa chạy yt-dlp** (nó gắn với
 * phiên của yt-dlp). Tự tải URL đó thì cũng trượt. Nhưng để yt-dlp tự tải thì
 * được: ra file 5.587.708 byte, header `ftyp` đúng mp4.
 *
 * KHÔNG CÒN `Promise.race` QUANH `sendVideo`. Đo thật: việc bị race bỏ VẪN là
 * đuôi hàng đợi của thread, nên việc kế tiếp phải chờ nó xong - trần 60 giây
 * không cứu được gì mà còn mở cửa GỬI TRÙNG (HEAD trả lời ở giây 61-299 thì
 * đường 1 gửi thật, đường 2 gửi thêm lần nữa). Bước dò thay thế nó: dò xong
 * nghĩa là host đã trả lời, nên nguy cơ `sendVideo` treo 300 giây còn rất mỏng.
 */

import type { API, ThreadType } from "zca-js";

import { guiFileKemCaption } from "../agent/tools/send-attachment-with-caption.js";
import { enqueueSend } from "../middleware/rate-limiter.js";
import { createLogger } from "../shared/logger.js";
import { laLoiMayChuTuChoi } from "../zalo/send-reply-in-parts.js";
import { downloadToFileFromPublicUrl } from "../shared/safe-remote-download-to-file.js";
import { withEmptyTempDir, withEmptyTempFile } from "../shared/temp-file-store.js";
import { kiemUrlVideoConSong, laKieuVideo } from "./kiem-url-video-truoc-khi-gui.js";
import { taiVideoBangYtDlp } from "./tai-bang-yt-dlp.js";
import type { ThongTinVideo } from "./thong-tin-video.js";

const log = createLogger("gui-video");

export type DichGuiVideo = {
  api: API;
  /** `<accountId>:<threadId>` - khóa hàng đợi giữ đúng thứ tự tin trong thread */
  threadKey: string;
  threadId: string;
  threadType: ThreadType;
};

export type KetQuaGui = { duong: "url" | "tai-ve" | "yt-dlp"; bytes: number | null };

/** Ba chỗ chạm ra ngoài, thay được từ ngoài CHỈ để test. Cùng nếp `createImageTool`. */
export type PhuThuocGuiVideo = {
  kiemUrl: typeof kiemUrlVideoConSong;
  taiUrl: typeof downloadToFileFromPublicUrl;
  taiYtDlp: typeof taiVideoBangYtDlp;
};

const PHU_THUOC_THAT: PhuThuocGuiVideo = {
  kiemUrl: kiemUrlVideoConSong,
  taiUrl: downloadToFileFromPublicUrl,
  taiYtDlp: taiVideoBangYtDlp,
};

/**
 * Tên file người nhận nhìn thấy. Suy từ tác giả + đuôi CỐ ĐỊNH `.mp4`.
 *
 * KHÔNG lấy tên từ URL của bên thứ ba: đó là đường vào cho ký tự lạ và phần mở
 * rộng bất ngờ, mà người nhận thì nhìn thấy chính cái tên này.
 */
function tenFile(video: ThongTinVideo): string {
  const goc = (video.tacGia ?? "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `${goc || "video"}.mp4`;
}

/**
 * Ảnh bìa an toàn để đẩy tới máy người nhận.
 *
 * `thumbnailUrl` là chuỗi của bên thứ ba và nó KHÔNG đi qua bước dò (máy chủ bot
 * không tải nó, nên đây không phải SSRF phía ta). Nhưng nó được đẩy tới máy của
 * MỌI người nhận trong nhóm, nên tối thiểu phải là một URL https hợp lệ.
 *
 * Không hợp lệ thì trả chuỗi rỗng - đúng thứ Facebook vốn đã cho (đo thật:
 * `thumbnail` và `thumbnails` đều `null`), nên nhánh này đằng nào cũng phải chịu được.
 */
function anhBiaAnToan(raw: string): string {
  if (raw === "") return "";
  try {
    return new URL(raw).protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

/** ĐƯỜNG 1: chỉ gửi đường dẫn, máy người nhận tải. */
async function guiBangUrl(dich: DichGuiVideo, video: ThongTinVideo, urlDaXacThuc: string): Promise<void> {
  await enqueueSend(dich.threadKey, () =>
    dich.api.sendVideo(
      {
        videoUrl: urlDaXacThuc,
        thumbnailUrl: anhBiaAnToan(video.thumbnailUrl),
        duration: video.durationMs,
        width: video.width,
        height: video.height,
      },
      dich.threadId,
      dich.threadType,
    ),
  );
}

/**
 * Gửi một file có sẵn trên đĩa. Dùng chung cho đường 2 và đường 3.
 *
 * Đi qua `guiFileKemCaption` chứ KHÔNG tự gọi `enqueueSend`: file đó là chỗ duy
 * nhất biết đường lui khi Zalo từ chối phần định dạng của caption, và chú thích
 * của nó nói thẳng "lưới an toàn phải nằm ở MỘT chỗ - rải ra bốn nơi thì sớm
 * muộn có nơi bị bỏ quên". Video không có caption nên hôm nay hai đường in ra
 * như nhau; đi vòng vẫn là thêm nơi thứ năm phải nhớ.
 */
async function guiFileCoSan(dich: DichGuiVideo, duongDan: string): Promise<void> {
  await guiFileKemCaption(dich.api, dich.threadKey, dich.threadId, dich.threadType, duongDan, undefined);
}

/** ĐƯỜNG 2: tự tải URL rồi upload. Chỉ dùng khi bước dò đã xác nhận URL sống. */
async function guiBangTaiUrl(
  dich: DichGuiVideo,
  video: ThongTinVideo,
  tranByte: number,
  phuThuoc: PhuThuocGuiVideo,
  urlDaXacThuc: string,
): Promise<number> {
  return await withEmptyTempFile(tenFile(video), async (duongDan) => {
    const { bytes, mediaType } = await phuThuoc.taiUrl(urlDaXacThuc, duongDan, { maxBytes: tranByte });
    // Bước dò đã kiểm kiểu nội dung, nhưng dò và tải là HAI request khác nhau -
    // CDN đổi ý giữa chừng (link hết hạn đúng lúc đó) là chuyện có thật. Ghi
    // HTML ra file `.mp4` rồi gửi đi thì người nhận nhận một tệp không mở được
    // mà bot vẫn báo thành công.
    if (!laKieuVideo(mediaType)) {
      throw new Error(`Nội dung tải về không phải video (${mediaType})`);
    }
    await guiFileCoSan(dich, duongDan);
    return bytes;
  });
}

/** ĐƯỜNG 3: để yt-dlp tự tải từ URL GỐC của người dùng rồi upload. */
async function guiBangYtDlp(
  dich: DichGuiVideo,
  urlGoc: string,
  tranByte: number,
  phuThuoc: PhuThuocGuiVideo,
): Promise<number> {
  return await withEmptyTempDir(async (thuMuc) => {
    const ket = await phuThuoc.taiYtDlp(urlGoc, thuMuc, tranByte);
    // Chở cờ `loiCauHinh` lên tiếp. Bản trước ném `new Error(ket.loi)` trần,
    // làm cờ biến mất đúng ở bước cuối - rồi tool trả câu chung "gửi video thất
    // bại". Ca hỏng: máy chủ chưa cài yt-dlp + link TikTok. TikWM đọc metadata
    // xong nên nhánh báo thiếu công cụ ở tầng chuỗi KHÔNG chạy; URL CDN dò
    // trượt; đường 3 cần yt-dlp - và người vận hành không có manh mối nào về
    // việc thiếu binary. Đó đúng là ca cờ này sinh ra để chống.
    if (!ket.ok) throw new LoiGuiVideo(ket.loi, { loiCauHinh: ket.loiCauHinh === true });
    await guiFileCoSan(dich, ket.duongDan);
    return ket.soByte;
  });
}

/**
 * Lỗi của đường gửi, mang theo LÝ DO CÓ KIỂU.
 *
 * Không có kiểu thì ở ranh giới tool mọi thứ đều trông giống nhau và bị nuốt
 * thành một câu chung, làm mất hai thông tin người dùng cần: "máy chủ thiếu
 * công cụ" (người vận hành phải sửa) và "video quá nặng" (người dùng chỉnh được
 * trần trên dashboard).
 */
export class LoiGuiVideo extends Error {
  readonly loiCauHinh: boolean;
  readonly quaNang: boolean;
  readonly soByte: number | null;

  constructor(message: string, tuyChon: { loiCauHinh?: boolean; quaNang?: boolean; soByte?: number } = {}) {
    super(message);
    this.name = "LoiGuiVideo";
    this.loiCauHinh = tuyChon.loiCauHinh === true;
    this.quaNang = tuyChon.quaNang === true;
    this.soByte = tuyChon.soByte ?? null;
  }
}

/**
 * Lỗi này có CHẮC CHẮN nghĩa là chưa tin nào tới người nhận không?
 *
 * Hai nguồn chắc chắn, và chỉ hai:
 *
 *   1. Máy chủ Zalo TRẢ LỜI và từ chối - `laLoiMayChuTuChoi` nhận ra qua
 *      `err.code` dạng SỐ mà zca-js gắn cho `ZaloApiError`. Đã trả lời nghĩa là
 *      đã xử lý xong và nói không.
 *   2. zca-js ném TRƯỚC khi POST: `sendVideo.ts:76` ném "Unable to get video
 *      content" khi chính request HEAD của nó hỏng. Lỗi này KHÔNG có mã số (đọc
 *      `ZaloApiError`: `code = code || null`) nên luật (1) không thấy - phải
 *      nhận theo chữ. Đây là ca đáng lùi nhất: URL sống với GET nhưng chết với
 *      HEAD, đúng thứ đã đo được trên CDN của TikTok.
 *
 * Mọi thứ khác (đứt mạng sau POST, thân trả lời hỏng) là KHÔNG RÕ KẾT CỤC.
 */
function chacChanChuaGui(err: unknown): boolean {
  if (laLoiMayChuTuChoi(err)) return true;
  const chu = err instanceof Error ? err.message : String(err);
  return chu.startsWith("Unable to get video content");
}

/**
 * Gửi video, chọn đường theo kết quả dò.
 *
 * Ném khi mọi đường đều hỏng - caller (tool) bắt lại và trả `ketQuaLoi`.
 *
 * `urlGoc` là đường dẫn NGƯỜI DÙNG gửi (đã qua whitelist), khác `video.videoUrl`
 * là đường dẫn CDN do nguồn trả về. Đường 3 cần cái trước, hai đường kia cần
 * cái sau - lẫn hai thứ này là yt-dlp được giao một URL CDN mà nó không phân
 * tích được.
 */
export async function guiVideoQuaZalo(
  dich: DichGuiVideo,
  video: ThongTinVideo,
  urlGoc: string,
  tranByte: number,
  phuThuoc: PhuThuocGuiVideo = PHU_THUOC_THAT,
): Promise<KetQuaGui> {
  const ketDo = await phuThuoc.kiemUrl(video.videoUrl);

  if (!ketDo.ok) {
    // Ghi lý do: đây chính là dữ liệu trả lời câu hỏi còn treo "URL của nguồn
    // nào mang đi được". Nuốt nó là mất luôn manh mối.
    log.warn(
      { ly: ketDo.ly, nguon: video.nguon, nenTang: video.nenTang },
      "đường dẫn video không dùng được - để yt-dlp tự tải",
    );
    const bytes = await guiBangYtDlp(dich, urlGoc, tranByte, phuThuoc);
    log.info({ bytes, nguon: video.nguon }, "đã gửi bằng đường yt-dlp tự tải");
    return { duong: "yt-dlp", bytes };
  }

  if (ketDo.soByte !== null && ketDo.soByte > tranByte) {
    // Biết cỡ THẬT trước khi gửi. Nguồn khai `fileSize` nhưng con số đó có thể
    // thiếu hoặc sai; `content-length` là của chính CDN sắp phục vụ file.
    // Đây là quyết định CHÍNH SÁCH, không phải hỏng hạ tầng - đánh dấu để tool
    // nói được con số cho người dùng thay vì nuốt thành "gửi video thất bại".
    // `kiem-gioi-han-video.ts` và hint trên dashboard đều hứa "nói với người
    // dùng con số này và rằng mức đó chỉnh được ở trang Cấu hình".
    throw new LoiGuiVideo(`Video ${Math.round(ketDo.soByte / 1024 / 1024)}MB, vượt giới hạn`, {
      quaNang: true,
      soByte: ketDo.soByte,
    });
  }

  if (ketDo.doiTenMien) {
    // Chuyển hướng RỜI họ tên miền: bên kia dắt ta sang một nơi khác hẳn, mà
    // `sendVideo` sẽ tự đi lại chặng đó bằng HEAD không qua lớp gác nào (zca-js
    // đi theo `location` đệ quy, không đếm hop, không kiểm địa chỉ). Tự tải thì
    // mọi hop đều bị kiểm lại.
    //
    // Chuyển hướng TRONG cùng họ tên miền KHÔNG đi đường này: đo được fbcdn làm
    // vậy với mọi video Facebook, và bắt tự tải ở đó là đẩy hàng chục MB qua
    // VPS mỗi lượt mà không đổi được gì về an toàn.
    log.warn(
      { nguon: video.nguon, nenTang: video.nenTang },
      "đường dẫn video chuyển hướng sang tên miền khác - tự tải thay vì giao cho sendVideo",
    );
    const bytes = await guiBangTaiUrl(dich, video, tranByte, phuThuoc, ketDo.urlCuoi);
    return { duong: "tai-ve", bytes };
  }

  try {
    await guiBangUrl(dich, video, ketDo.urlCuoi);
    // `kieuNoiDung` vào log chứ không phải trường chết: đây là dữ liệu để trả
    // lời câu hỏi còn treo "URL của nguồn nào mang đi được".
    log.info(
      { nguon: video.nguon, kieuNoiDung: ketDo.kieuNoiDung, bytes: ketDo.soByte },
      "đã gửi bằng đường dẫn",
    );
    return { duong: "url", bytes: ketDo.soByte };
  } catch (err) {
    // CHỈ lùi sang đường 2 khi CHẮC CHẮN chưa có tin nào lọt qua. Bắt mọi lỗi
    // là mở cửa GỬI HAI LẦN: zca-js còn ném SAU khi đã POST (giải mã thân trả
    // lời hỏng, đứt mạng giữa chừng), và lúc đó tin có thể đã tới người nhận.
    // Hai video liên tiếp trong một thread đúng là tín hiệu spam mà cả trần
    // 15/giờ sinh ra để tránh. Luật này đã có sẵn trong repo, ghi ở
    // `send-attachment-with-caption.ts`: "gửi lại lúc đó là nhân đôi file
    // trước mặt người dùng".
    if (!chacChanChuaGui(err)) {
      log.error({ err, nguon: video.nguon }, "gửi bằng đường dẫn hỏng KHÔNG rõ kết cục - không gửi lại");
      throw err;
    }
    log.warn(
      { err, nguon: video.nguon, nenTang: video.nenTang },
      "Zalo từ chối đường dẫn - chuyển sang tự tải rồi upload",
    );
    const bytes = await guiBangTaiUrl(dich, video, tranByte, phuThuoc, ketDo.urlCuoi);
    log.info({ bytes, nguon: video.nguon }, "đã gửi bằng đường tự tải");
    return { duong: "tai-ve", bytes };
  }
}
