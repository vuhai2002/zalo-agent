/**
 * Quyết định THEO TỪNG TRANG một trang PDF lấy chữ từ đâu. Quyết theo cả tệp
 * (rỗng hết thì là bản quét) bỏ lọt PDF trộn và trang chỉ có số trang - Hermes
 * từng ghi lại đúng ca này: PDF quét một phần "chuyển đổi thành công" thành
 * mất dữ liệu câm.
 *
 * Vì sao chỉ dựa vào độ dài chữ, KHÔNG xét "trang có vẽ ảnh không": đã thử và
 * đo hai lỗi. (1) pdf.js âm thầm bỏ ảnh vượt `maxImageSize` TRƯỚC khi phát lệnh
 * vẽ, nên trang quét 600 dpi hiện ra như trang trắng và bị bỏ - mất dữ liệu câm.
 * (2) Dựng danh sách lệnh vẽ là GIẢI MÃ mọi ảnh: 300 trang quét mất 49 giây,
 * vượt hạn đọc tệp. Nên trang ít chữ đi thẳng sang OCR; trang trắng thật thì
 * model đọc ảnh trả "[trang trống]" - tốn một lượt vision, không mất gì.
 *
 * Giới hạn biết trước: trang quét có kèm dòng chữ thật >= ngưỡng (dấu đóng của
 * máy photocopy, số Bates) bị coi là trang chữ, phần thân quét không được OCR.
 */

export type ThongTinTrang = {
  so: number;
  /** Số ký tự chữ (bỏ khoảng trắng) pdf.js đọc được - GỒM cả lớp OCR ẩn của máy quét */
  doDaiChu: number;
};

export type LoaiTrang = "chu" | "ocr";

export const NGUONG_KY_TU_TRANG = 30;

export function phanLoaiTrang(t: ThongTinTrang): LoaiTrang {
  return t.doDaiChu >= NGUONG_KY_TU_TRANG ? "chu" : "ocr";
}
