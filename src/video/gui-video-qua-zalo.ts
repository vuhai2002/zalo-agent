/**
 * Gửi video qua Zalo. MỘT đường duy nhất, và mọi bước đều có lý do đo được.
 *
 *   1. DÒ url của nguồn (rẻ, có gác)  -> còn sống không, kiểu gì, nặng bao nhiêu
 *   2. LẤY BYTE VÀO RAM               -> dò qua thì tải thẳng; dò trượt thì để
 *                                        yt-dlp tự tải qua stdout
 *   3. ĐỌC KHUNG HÌNH từ chính buffer -> không tin metadata của nguồn
 *   4. XIN ẢNH BÌA của Zalo           -> `parseLink`, không tốn byte nào
 *   5. UPLOAD từ RAM lên Zalo         -> nhận lại một URL trên hạ tầng Zalo
 *   6. `sendVideo` với URL đó
 *
 * VÌ SAO PHẢI UPLOAD - đo bằng lượt gửi thật tới điện thoại người dùng, ba biến
 * thể cùng một video, chỉ khác chỗ chứa:
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
 * VÌ SAO XIN ẢNH BÌA CỦA ZALO: đưa `thumbnailUrl` trỏ host ngoài thì thẻ video
 * hiện ĐEN THUI - Zalo rất kén host ảnh.
 */

import type { API, ThreadType } from "zca-js";

import { createLogger } from "../shared/logger.js";
import { docKhungHinhMp4 } from "./doc-khung-hinh-mp4.js";
import { kiemUrlVideoConSong } from "./kiem-url-video-truoc-khi-gui.js";
import { layAnhBiaZalo } from "./lay-anh-bia-zalo.js";
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

export type KetQuaGui = { duong: "url" | "yt-dlp"; bytes: number };

/** Các chỗ chạm ra ngoài, thay được từ ngoài CHỈ để test */
export type PhuThuocGuiVideo = {
  kiemUrl: typeof kiemUrlVideoConSong;
  taiUrl: typeof taiTuUrlVaoRam;
  taiYtDlp: typeof taiBangYtDlpVaoRam;
  layAnhBia: typeof layAnhBiaZalo;
};

const PHU_THUOC_THAT: PhuThuocGuiVideo = {
  kiemUrl: kiemUrlVideoConSong,
  taiUrl: taiTuUrlVaoRam,
  taiYtDlp: taiBangYtDlpVaoRam,
  layAnhBia: layAnhBiaZalo,
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

/**
 * Ảnh bìa an toàn để đẩy tới máy người nhận.
 *
 * Ưu tiên ảnh của Zalo. Không có thì dùng của nguồn, nhưng phải là https hợp lệ:
 * chuỗi này đến từ bên thứ ba và được đẩy tới máy của MỌI người nhận trong nhóm.
 */
function anhBiaAnToan(cuaZalo: string | null, cuaNguon: string): string {
  if (cuaZalo !== null && cuaZalo !== "") return cuaZalo;
  if (cuaNguon === "") return "";
  try {
    return new URL(cuaNguon).protocol === "https:" ? cuaNguon : "";
  } catch {
    return "";
  }
}

/** Tên file người nhận nhìn thấy khi tải về. Đuôi CỐ ĐỊNH, không lấy từ URL người lạ. */
function tenFile(video: ThongTinVideo): string {
  const goc = (video.tacGia ?? "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `${goc || "video"}.mp4`;
}

/** Upload buffer lên Zalo, trả về URL trên hạ tầng của họ. Có trần thời gian. */
async function upLenZalo(dich: DichGuiVideo, byte: Buffer, ten: string): Promise<string> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const goi = (dich.api as any).uploadAttachment(
    [{ data: byte, filename: ten, metadata: { totalSize: byte.length } }],
    dich.threadId,
    dich.threadType,
  ) as Promise<unknown>;

  const ket = await Promise.race([
    goi,
    new Promise<never>((_, hong) =>
      setTimeout(
        () => hong(new LoiGuiVideo(`Upload lên Zalo quá ${TRAN_UPLOAD_MS}ms`)),
        TRAN_UPLOAD_MS,
      ).unref(),
    ),
  ]);

  const r = (Array.isArray(ket) ? ket[0] : ket) as
    | { fileUrl?: string; normalUrl?: string; hdUrl?: string }
    | undefined;
  const url = r?.fileUrl ?? r?.normalUrl ?? r?.hdUrl ?? "";
  if (url === "") throw new LoiGuiVideo("Zalo nhận file nhưng không trả về đường dẫn");
  return url;
}

/**
 * Gửi video. Ném khi không gửi được - caller (tool) bắt lại và trả `ketQuaLoi`.
 *
 * `urlGoc` là đường dẫn NGƯỜI DÙNG gửi (đã qua whitelist), khác `video.videoUrl`
 * là đường dẫn CDN do nguồn trả về. yt-dlp và `parseLink` đều cần cái trước.
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

  // 3. Khung hình đọc từ CHÍNH buffer sắp gửi - không tin nguồn khai gì
  const khung = docKhungHinhMp4(tai.byte);
  if (khung === null) {
    // Không đọc được thì dùng số của nguồn. Ghi log vì đây là đường dẫn tới
    // đúng lớp lỗi đã làm crash máy người dùng.
    log.warn(
      { nguon: video.nguon, nenTang: video.nenTang },
      "không đọc được khung hình từ file - dùng số của nguồn, có thể sai",
    );
  }
  const co = khung ?? { width: video.width, height: video.height };

  // 4. Ảnh bìa của Zalo - không tốn byte nào
  const anhBia = anhBiaAnToan(await phuThuoc.layAnhBia(dich.api, urlGoc), video.thumbnailUrl);

  // 5 + 6. Upload rồi gửi. Cả hai đi qua hàng đợi gửi của thread để giữ thứ tự.
  const urlZalo = await upLenZalo(dich, tai.byte, tenFile(video));
  await dich.api.sendVideo(
    {
      videoUrl: urlZalo,
      thumbnailUrl: anhBia,
      duration: video.durationMs,
      width: co.width,
      height: co.height,
    },
    dich.threadId,
    dich.threadType,
  );

  log.info(
    {
      nguon: video.nguon,
      duong: tai.duong,
      bytes: tai.byte.length,
      khung: `${co.width}x${co.height}`,
      khungDocDuoc: khung !== null,
      anhBiaZalo: anhBia !== "" && anhBia !== video.thumbnailUrl,
    },
    "đã gửi video",
  );
  return { duong: tai.duong, bytes: tai.byte.length };
}
