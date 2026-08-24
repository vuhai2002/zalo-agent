/**
 * Gửi video qua Zalo. MỘT đường duy nhất, và mọi bước đều có lý do đo được.
 *
 *   1. DÒ url của nguồn (rẻ, có gác)  -> còn sống không, kiểu gì, nặng bao nhiêu
 *   2. LẤY BYTE VÀO RAM               -> dò qua thì tải thẳng; dò trượt thì để
 *                                        yt-dlp tự tải qua stdout
 *   3. ĐỌC KHUNG HÌNH từ chính buffer -> không tin metadata của nguồn
 *   4. DỰNG POSTER                    -> tải ảnh bìa nguồn rồi upload lên Zalo
 *   5a. CÓ poster  -> upload video lên Zalo -> `sendVideo` (thẻ video)
 *   5b. KHÔNG có   -> gửi DẠNG FILE (không cần poster)
 *
 * VÌ SAO PHẢI UPLOAD - đo bằng lượt gửi thật tới điện thoại người dùng, cùng một
 * video chỉ khác chỗ chứa:
 *
 *   videoUrl = URL TikTok/Facebook  -> máy tính xem được, ĐIỆN THOẠI KHÔNG
 *   videoUrl = URL của Zalo         -> điện thoại xem mượt
 *
 * Đã rà cả 140 API của zca-js: không có đường nào đưa Zalo một URL rồi Zalo tự
 * tải về tự host. Nên muốn xem được trên điện thoại thì byte buộc phải đi qua
 * đây. Đổi lại KHÔNG chạm đĩa - xem `tai-video-vao-ram.ts`.
 *
 * VÌ SAO ĐỌC KHUNG HÌNH TỪ FILE: khai sai khung làm ứng dụng Zalo trên điện
 * thoại CRASH (ca thật). TikWM không trả width/height gì cả; yt-dlp thì format
 * được chọn không mang, còn mảng `formats` khai lệch gấp đôi so với luồng thật.
 *
 * VÌ SAO POSTER PHẢI UPLOAD LÊN ZALO: URL ảnh host ngoài -> thẻ video ĐEN THUI;
 * `thumbnailUrl` rỗng -> Zalo TỪ CHỐI (code 114); `parseLink` -> trả placeholder
 * rác cho Facebook. Chi tiết ở `chuan-bi-anh-bia-video.ts`.
 */

import type { API, ThreadType } from "zca-js";

import { createLogger } from "../shared/logger.js";
import { chuanBiAnhBiaVideo } from "./chuan-bi-anh-bia-video.js";
import { docThongTinMp4 } from "./doc-khung-hinh-mp4.js";
import { kiemUrlVideoConSong } from "./kiem-url-video-truoc-khi-gui.js";
import { taiBangYtDlpVaoRam, taiTuUrlVaoRam } from "./tai-video-vao-ram.js";
import type { ThongTinVideo } from "./thong-tin-video.js";

const log = createLogger("gui-video");

/**
 * Trần thời gian cho lượt upload.
 *
 * BẮT BUỘC phải có: `uploadAttachment` với video đăng ký callback theo `fileId`
 * và chỉ được giải quyết khi sự kiện hoàn tất tới qua WEBSOCKET (`listen.ts`
 * của zca-js). Không có listener - hoặc listener rớt giữa chừng - thì promise
 * treo VĨNH VIỄN, và zca-js không đặt timeout nào. Đã gặp thật lúc thử: bot
 * đang chạy giữ mất suất listener nên lời gọi treo cho tới khi bị giết.
 */
const TRAN_UPLOAD_MS = 5 * 60_000;

export type DichGuiVideo = {
  api: API;
  /** `<accountId>:<threadId>` - khóa hàng đợi giữ đúng thứ tự tin trong thread */
  threadKey: string;
  threadId: string;
  threadType: ThreadType;
};

/** `dang` cho biết đã gửi thẻ video (có poster) hay gửi dạng file (không poster) */
export type KetQuaGui = { duong: "url" | "yt-dlp"; bytes: number; dang: "video" | "file" };

/** Các chỗ chạm ra ngoài, thay được từ ngoài CHỈ để test */
export type PhuThuocGuiVideo = {
  kiemUrl: typeof kiemUrlVideoConSong;
  taiUrl: typeof taiTuUrlVaoRam;
  taiYtDlp: typeof taiBangYtDlpVaoRam;
  chuanBiAnhBia: typeof chuanBiAnhBiaVideo;
};

const PHU_THUOC_THAT: PhuThuocGuiVideo = {
  kiemUrl: kiemUrlVideoConSong,
  taiUrl: taiTuUrlVaoRam,
  taiYtDlp: taiBangYtDlpVaoRam,
  chuanBiAnhBia: chuanBiAnhBiaVideo,
};

/**
 * Lỗi của đường gửi, mang theo LÝ DO CÓ KIỂU.
 *
 * Không có kiểu thì ở ranh giới tool mọi thứ trông giống nhau và bị nuốt thành
 * một câu chung, làm mất hai thông tin người ta cần: "máy chủ thiếu công cụ"
 * (người vận hành phải sửa) và "video quá nặng" kèm CON SỐ (người dùng chỉnh
 * được trần trên dashboard).
 */
export class LoiGuiVideo extends Error {
  readonly loiCauHinh: boolean;
  readonly quaNang: boolean;
  readonly soByte: number | null;

  constructor(
    message: string,
    tuyChon: { loiCauHinh?: boolean; quaNang?: boolean; soByte?: number } = {},
  ) {
    super(message);
    this.name = "LoiGuiVideo";
    this.loiCauHinh = tuyChon.loiCauHinh === true;
    this.quaNang = tuyChon.quaNang === true;
    this.soByte = tuyChon.soByte ?? null;
  }
}

/** Tên file người nhận nhìn thấy khi gửi dạng file. Đuôi CỐ ĐỊNH, không lấy từ URL người lạ. */
function tenFile(video: ThongTinVideo): string {
  const goc = (video.tacGia ?? "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `${goc || "video"}.mp4`;
}

/**
 * Bọc trần thời gian quanh một lời gọi upload video của zca-js.
 *
 * BẮT BUỘC: `uploadAttachment` cho video đăng ký callback theo `fileId` và chỉ
 * giải quyết khi sự kiện hoàn tất tới qua WEBSOCKET. Mất listener thì promise
 * treo VĨNH VIỄN (zca-js không đặt timeout). Cả `sendVideo` (upload rồi gửi) lẫn
 * `sendMessage` với attachment video đều dính, nên cả hai đường gửi đều bọc.
 */
function voiTranUpload<T>(goi: Promise<T>): Promise<T> {
  return Promise.race([
    goi,
    new Promise<never>((_, hong) =>
      setTimeout(
        () => hong(new LoiGuiVideo(`Gửi lên Zalo quá ${TRAN_UPLOAD_MS}ms`)),
        TRAN_UPLOAD_MS,
      ).unref(),
    ),
  ]);
}

/** Upload buffer video lên Zalo, trả về URL trên hạ tầng của họ. */
async function upLenZalo(dich: DichGuiVideo, byte: Buffer, ten: string): Promise<string> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const goi = (dich.api as any).uploadAttachment(
    [{ data: byte, filename: ten, metadata: { totalSize: byte.length } }],
    dich.threadId,
    dich.threadType,
  ) as Promise<unknown>;

  const ket = await voiTranUpload(goi);
  const r = (Array.isArray(ket) ? ket[0] : ket) as
    | { fileUrl?: string; normalUrl?: string; hdUrl?: string }
    | undefined;
  const url = r?.fileUrl ?? r?.normalUrl ?? r?.hdUrl ?? "";
  if (url === "") throw new LoiGuiVideo("Zalo nhận file nhưng không trả về đường dẫn");
  return url;
}

/**
 * Gửi video DẠNG FILE - đường lui khi không dựng được poster.
 *
 * `sendMessage` với attachment `.mp4` KHÔNG cần thumbnail (đã đọc zca-js: chỉ
 * GIF mới tự sinh thumb). Nhận Buffer trực tiếp nên vẫn KHÔNG chạm đĩa. Người
 * dùng chốt: thà gửi file còn hơn thẻ video dính ảnh placeholder nhìn rẻ.
 */
async function guiDangFile(dich: DichGuiVideo, byte: Buffer, ten: string): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const goi = (dich.api as any).sendMessage(
    { attachments: [{ data: byte, filename: ten, metadata: { totalSize: byte.length } }] },
    dich.threadId,
    dich.threadType,
  ) as Promise<unknown>;
  await voiTranUpload(goi);
}

/**
 * Gửi video. Ném khi không gửi được - caller (tool) bắt lại và trả `ketQuaLoi`.
 *
 * `urlGoc` là đường dẫn NGƯỜI DÙNG gửi (đã qua whitelist), khác `video.videoUrl`
 * là đường dẫn CDN do nguồn trả về. yt-dlp tự tải thì cần cái trước.
 */
export async function guiVideoQuaZalo(
  dich: DichGuiVideo,
  video: ThongTinVideo,
  urlGoc: string,
  tranByte: number,
  phuThuoc: PhuThuocGuiVideo = PHU_THUOC_THAT,
): Promise<KetQuaGui> {
  // 1. Dò - rẻ, và cho biết nên lấy byte từ đâu
  const ketDo = await phuThuoc.kiemUrl(video.videoUrl);
  if (ketDo.ok && ketDo.soByte !== null && ketDo.soByte > tranByte) {
    throw new LoiGuiVideo(`Video ${Math.round(ketDo.soByte / 1024 / 1024)}MB, vượt giới hạn`, {
      quaNang: true,
      soByte: ketDo.soByte,
    });
  }

  // 2. Byte vào RAM
  const tai = ketDo.ok
    ? await phuThuoc.taiUrl(ketDo.urlCuoi, tranByte)
    : await phuThuoc.taiYtDlp(urlGoc, tranByte);

  if (!tai.ok) {
    if (!ketDo.ok) {
      log.warn({ ly: ketDo.ly, nguon: video.nguon }, "URL nguồn không dùng được, yt-dlp cũng hỏng");
    }
    throw new LoiGuiVideo(tai.loi, { loiCauHinh: tai.loiCauHinh === true });
  }
  if (tai.byte.length > tranByte) {
    throw new LoiGuiVideo("Video vượt giới hạn dung lượng", {
      quaNang: true,
      soByte: tai.byte.length,
    });
  }

  // 3. Khung hình + thời lượng đọc từ CHÍNH buffer sắp gửi - MỘT lượt duyệt cây
  // hộp mp4, không tin nguồn khai gì.
  const { khung, thoiLuongMs } = docThongTinMp4(tai.byte);
  if (khung === null) {
    // Không đọc được thì dùng số của nguồn. Ghi log vì đây là đường dẫn tới
    // đúng lớp lỗi đã làm crash máy người dùng.
    log.warn(
      { nguon: video.nguon, nenTang: video.nenTang },
      "không đọc được khung hình từ file - dùng số của nguồn, có thể sai",
    );
  }
  const co = khung ?? { width: video.width, height: video.height };
  // Thời lượng: LẤY CỦA NGUỒN TRƯỚC (TikTok/Facebook trả sẵn, tin cậy), file chỉ
  // LẤP CHỖ TRỐNG khi nguồn không có (Instagram trả `duration: null` -> durationMs
  // = 0). Khác với khung hình (file LUÔN thắng vì khai sai khung làm crash); thời
  // lượng khai sai chỉ là nhãn hiển thị sai, không crash, nên không cần lật nguồn.
  const durationMs = video.durationMs || thoiLuongMs || 0;

  // 4. Poster: tải ảnh bìa nguồn rồi upload lên Zalo. Không dựng được thì `null`.
  const poster = await phuThuoc.chuanBiAnhBia(
    { api: dich.api, threadId: dich.threadId, threadType: dich.threadType },
    video.thumbnailUrl,
  );

  // 5 + 6. Không có poster thì gửi DẠNG FILE, thà vậy còn hơn thẻ video dính
  // placeholder rẻ tiền (Zalo còn từ chối thumbnail rỗng). Gửi thẳng qua `api`
  // để nằm trong suất hàng đợi tải, giữ đúng thứ tự tin trong thread.
  const ten = tenFile(video);
  let dang: "video" | "file";
  if (poster === null) {
    await guiDangFile(dich, tai.byte, ten);
    dang = "file";
  } else {
    const urlZalo = await upLenZalo(dich, tai.byte, ten);
    await dich.api.sendVideo(
      {
        videoUrl: urlZalo,
        thumbnailUrl: poster,
        duration: durationMs,
        width: co.width,
        height: co.height,
      },
      dich.threadId,
      dich.threadType,
    );
    dang = "video";
  }

  log.info(
    {
      nguon: video.nguon,
      duong: tai.duong,
      bytes: tai.byte.length,
      khung: `${co.width}x${co.height}`,
      khungDocDuoc: khung !== null,
      dang,
    },
    "đã gửi video",
  );
  return { duong: tai.duong, bytes: tai.byte.length, dang };
}
