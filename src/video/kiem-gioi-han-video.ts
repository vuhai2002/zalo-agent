/**
 * Kiểm video có nằm trong giới hạn cho phép không.
 *
 * CHẠY SAU bước đọc thông tin, TRƯỚC bước gửi. Đó là cả điểm của thiết kế: cả
 * hai nguồn đều trả `duration` ở bước metadata (tốn đúng một request), nên video
 * 2 tiếng bị từ chối mà máy chủ không tải một byte nào.
 *
 * Tách khỏi tool vì đây là luật thuần - không đụng mạng, không đụng đĩa, không
 * đụng Zalo - nên test được trực tiếp thay vì phải dựng cả một lượt agent.
 */

import type { ThongTinVideo } from "./thong-tin-video.js";

export type GioiHanVideo = {
  /** Phút */
  thoiLuongToiDa: number;
  /** MB */
  dungLuongToiDa: number;
};

export type KetQuaKiem = { ok: true } | { ok: false; loi: string };

function phutDep(ms: number): string {
  const phut = ms / 60_000;
  // Dưới 1 phút thì nói bằng giây - "0,3 phút" đọc rất khó hình dung.
  return phut < 1 ? `${Math.round(ms / 1000)} giây` : `${phut.toFixed(1).replace(/\.0$/, "")} phút`;
}

export function kiemGioiHanVideo(video: ThongTinVideo, gh: GioiHanVideo): KetQuaKiem {
  // `durationMs = 0` nghĩa là nguồn KHÔNG NÓI, không phải video dài 0 giây.
  // Chặn ở đây là chặn oan; cho qua thì còn trần dung lượng đỡ. Chọn cho qua vì
  // từ chối một video hợp lệ vì thiếu dữ liệu là kết cục tệ hơn.
  if (video.durationMs > 0) {
    const tranMs = gh.thoiLuongToiDa * 60_000;
    if (video.durationMs > tranMs) {
      return {
        ok: false,
        loi:
          `Video dài ${phutDep(video.durationMs)}, vượt mức cho phép ${gh.thoiLuongToiDa} phút. ` +
          `Nói với người dùng con số này và rằng mức đó chỉnh được ở trang Cấu hình.`,
      };
    }
  }

  if (video.fileSize !== null && video.fileSize > 0) {
    const tranByte = gh.dungLuongToiDa * 1024 * 1024;
    if (video.fileSize > tranByte) {
      const mb = (video.fileSize / 1024 / 1024).toFixed(1);
      return {
        ok: false,
        loi:
          `Video nặng ${mb} MB, vượt mức cho phép ${gh.dungLuongToiDa} MB. ` +
          `Nói với người dùng con số này.`,
      };
    }
  }

  return { ok: true };
}
