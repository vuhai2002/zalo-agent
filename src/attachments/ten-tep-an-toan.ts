import { locKyTuAn } from "../agent/tools/tag-ky-tu-an.js";

/**
 * Làm sạch tên tệp do NGƯỜI LẠ đặt trước khi nó vào lịch sử hội thoại (thứ
 * model đọc lại ở mọi lượt sau).
 *
 * Bỏ những ký tự dùng được để giả nhãn của hệ thống (`[`, `]`, `<`, `>`, ngoặc
 * kép, backtick, xuống dòng - cùng bài học `tacGia` của tool video: chuỗi người
 * lạ đặt mà đóng được nhãn thật rồi mở nhãn giả), ký tự điều khiển, ký tự đảo
 * chiều bidi (giả đuôi kiểu "hoa-don<RLO>fdp.exe"), và ký tự hiển-thị-rỗng.
 * Cắt còn `TRAN_DAI_TEN` ký tự nhưng GIỮ đuôi tệp.
 *
 * Module thuần.
 */

const TRAN_DAI_TEN = 100;
const KY_TU_CAM = /[[\]<>"`\u0000-\u001F\u007F‪-‮⁦-⁩‎‏]/g;

export function lamSachTenTep(ten: string): string {
  const sach = locKyTuAn(ten).replace(KY_TU_CAM, " ").replace(/\s+/g, " ").trim();
  if (!sach) return "tệp";
  if (sach.length <= TRAN_DAI_TEN) return sach;
  const duoi = /\.[A-Za-z0-9]{1,8}$/.exec(sach)?.[0] ?? "";
  return `${sach.slice(0, TRAN_DAI_TEN - duoi.length - 3)}...${duoi}`;
}
