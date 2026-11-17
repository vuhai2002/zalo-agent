import { phucVuTienTrinhCon } from "../shared/phuc-vu-tien-trinh-con.js";
import type { KetQuaTrichXuatTep } from "./attachment-extract-types.js";
import { trichXuatTepTrongCon, type DuLieuTrichXuat } from "./trich-xuat-tep-trong-con.js";

/**
 * Thân TIẾN TRÌNH CON đọc tệp người dùng gửi, dựng bởi `trich-xuat-tep.ts`.
 * Chỉ import module THUẦN (không env/DB/logger) - con chạy với env tối thiểu.
 */
phucVuTienTrinhCon<DuLieuTrichXuat, KetQuaTrichXuatTep>(trichXuatTepTrongCon);
