/**
 * Kiểu dùng chung của đường đọc tệp đính kèm (tệp người dùng gửi qua Zalo).
 * Module thuần - chạy được cả trong tiến trình con đọc tài liệu.
 */

export type DinhDangTep = "pdf" | "docx" | "xlsx" | "doc" | "anh" | "van-ban" | "khong-ro";

export type MaLoiTep = "mat-khau" | "chua-ho-tro" | "hong" | "qua-lon";

export type ThongKeCot = { cot: string; tong: number; soO: number };

export type ThongKeSheet = { soHangDuLieu: number; cot: ThongKeCot[]; soOCongThuc: number };

export type PhanNoiDung = {
  /** "Trang 3", "Sheet \"Tháng 3\" (ẩn)" - chuỗi do máy chủ dựng, có thể chứa tên sheet của người lạ */
  nhan: string;
  chu: string;
  nguon: "chu" | "ocr";
  thongKe?: ThongKeSheet;
};

export type KetQuaTrichXuatTep = {
  dinhDang: DinhDangTep;
  /** Chỉ PDF */
  soTrang?: number;
  phan: PhanNoiDung[];
  /** PDF: trang không có lớp chữ, cần OCR */
  trangCanOcr: number[];
  /** "Đã bỏ 1 sheet ẩn hẳn", "Đã cắt ở 400.000 ký tự" */
  canhBao: string[];
};

/**
 * Lỗi NỘI DUNG tệp, mang mã có kiểu. Qua ranh giới tiến trình con nó đi bằng
 * `ma` (xem `phucVuTienTrinhCon`) rồi được dựng lại ở phía cha - caller rẽ
 * nhánh bằng mã, không bằng so chữ.
 */
export class LoiTep extends Error {
  constructor(
    readonly ma: MaLoiTep,
    message: string,
  ) {
    super(message);
    this.name = "LoiTep";
  }
}
