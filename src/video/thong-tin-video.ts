/**
 * Hình dạng dữ liệu chung mà MỌI nguồn video phải trả về.
 *
 * VÌ SAO CÓ FILE RIÊNG: hai nguồn (TikWM và yt-dlp) trả JSON khác hẳn nhau,
 * nhưng tầng trên chỉ được thấy MỘT hình dạng. Để tầng trên tự đọc JSON thô của
 * từng nguồn thì thêm nguồn thứ ba là phải sửa cả chuỗi gọi.
 *
 * `sendVideo` của zca-js đòi ĐỦ `videoUrl`, `thumbnailUrl`, `duration`, `width`,
 * `height` - nên nguồn nào thiếu trường nào thì phải tự bù ở tầng nguồn, không
 * đẩy `undefined` lên trên.
 */

import type { NenTangVideo } from "./whitelist-nguon-video.js";

export type ThongTinVideo = {
  /** URL phát trực tiếp, ĐÃ bỏ watermark */
  videoUrl: string;
  /** Ảnh bìa - `sendVideo` bắt buộc có */
  thumbnailUrl: string;
  /** Mili giây. `sendVideo` nhận ms, còn nguồn thường trả GIÂY - đổi ở tầng nguồn */
  durationMs: number;
  width: number;
  height: number;
  /** Byte. `null` khi nguồn không nói - tầng trên phải chịu được */
  fileSize: number | null;
  /**
   * Tên tác giả. DÙNG DUY NHẤT để đặt tên file tạm, KHÔNG đưa cho model.
   *
   * Đây là chuỗi TỰ DO do người đăng video tự đặt (`uploader`/`channel` của
   * yt-dlp là tên hiển thị). Đã cắt ngắn ở tầng nguồn, nhưng đừng dựa vào đó:
   * chỗ dùng nó (`gui-video-qua-zalo.ts`) còn lọc thêm một lớp nữa.
   *
   * Đưa nó vào câu tool trả cho model hay vào lịch sử là mở một lối tiêm chỉ
   * dẫn, và lối đó BỀN vì lịch sử được đọc lại ở mọi lượt sau. Đã từng như vậy,
   * đã bỏ.
   */
  tacGia: string | null;
  /** Nguồn nào lấy được - ghi log và nói cho người dùng khi phải dùng dự phòng */
  nguon: TenNguonVideo;
  nenTang: NenTangVideo;
};

export type TenNguonVideo = "tikwm" | "yt-dlp";

export type KetQuaNguon =
  | { ok: true; video: ThongTinVideo }
  | {
      ok: false;
      loi: string;
      thuLaiDuoc: boolean;
      /**
       * Bệnh nằm ở MÁY CHỦ, không nằm ở video (vd chưa cài yt-dlp).
       *
       * Là CỜ CÓ KIỂU chứ không phải chuỗi, vì `loi` chở chữ do bên thứ ba sinh
       * ra (stderr của yt-dlp, thân lỗi của TikWM) - thứ đó không được chảy vào
       * câu tool trả cho model. Tool đọc cờ này rồi tự chọn một câu khác hẳn:
       * nói "video có thể ở chế độ riêng tư" trong khi máy chủ thiếu binary là
       * dắt người vận hành đi sai hướng đúng lúc họ cần đúng hướng nhất.
       */
      loiCauHinh?: boolean;
      /**
       * Nội dung đòi ĐĂNG NHẬP (story Facebook, bài trong nhóm kín).
       *
       * Cờ riêng vì đây không phải "video hỏng" cũng không phải "máy chủ thiếu
       * công cụ" - nó là loại link bot KHÔNG BAO GIỜ tải được, và người dùng
       * cần biết để khỏi thử lại. Đo thật: Facebook trả `302 -> login.php`.
       */
      canDangNhap?: boolean;
    };

/**
 * Kích cỡ mặc định khi nguồn không nói.
 *
 * `sendVideo` mặc định 1280x720 (NGANG) nếu không truyền - sai hẳn với video
 * dọc của TikTok/Reels, và Zalo dựng khung theo số này nên video hiện méo. Đặt
 * mặc định DỌC vì đó là ca áp đảo của cả hai nền tảng.
 */
export const CO_MAC_DINH = { width: 576, height: 1024 } as const;

/**
 * Mặc định NGANG, dùng khi nguồn không nói gì và nền tảng không phải TikTok.
 *
 * Bằng đúng mặc định của `sendVideo` trong zca-js (1280x720). Có mặt vì đoán
 * DỌC cho một video Facebook ngang đã làm ứng dụng Zalo trên điện thoại crash -
 * xem `khungHinh` trong `nguon-yt-dlp.ts`.
 */
export const CO_MAC_DINH_NGANG = { width: 1280, height: 720 } as const;
