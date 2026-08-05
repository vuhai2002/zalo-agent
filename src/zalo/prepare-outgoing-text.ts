import type { Style } from "zca-js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { markdownSangStyleZalo } from "./markdown-to-zalo-styles.js";
import {
  lamSachGiuDinhDang,
  lamSachTraLoi,
  type KetQuaLamSach,
} from "./sanitize-reply-text.js";

/**
 * Chọn đường làm sạch / dịch định dạng theo cấu hình `ZALO_RICH_TEXT_ENABLED`.
 *
 * Gom vào một chỗ vì có BA nơi phải chọn cùng một đường (lượt chat, lịch hẹn
 * gửi payload, lịch hẹn gửi câu của agent). Rải phép kiểm cấu hình ra ba chỗ là
 * mời gọi ca lệch pha: nơi này giữ dấu markdown còn nơi kia đã xóa, và tin theo
 * lịch hiện nguyên ký tự `**` trong khi tin chat thì không.
 *
 * Hai bước CỐ Ý tách rời chứ không gộp một hàm: giữa chúng, đường lịch hẹn còn
 * chèn các bước riêng (chặn thì không gửi, chốt run, đếm trần ngày) và bước dịch
 * phải nằm sát lúc gửi để chữ ghi vào history đúng bằng chữ người dùng thấy.
 */

/** Bước 1: lá chắn (rò prompt, `[SILENT]`) - có xóa markdown hay không tùy cấu hình */
export function lamSachTheoCauHinh(text: string): KetQuaLamSach {
  return getTuning("ZALO_RICH_TEXT_ENABLED") ? lamSachGiuDinhDang(text) : lamSachTraLoi(text);
}

/** Bước 2: dịch markdown thành `Style` của Zalo; tắt cấu hình thì trả chữ y nguyên */
export function dinhDangNeuBat(text: string): { text: string; styles: Style[] } {
  if (!getTuning("ZALO_RICH_TEXT_ENABLED")) return { text, styles: [] };
  return markdownSangStyleZalo(text);
}
