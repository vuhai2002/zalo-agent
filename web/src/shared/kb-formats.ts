/**
 * 5 định dạng nguồn Kho tri thức đọc được chữ.
 *
 * Giữ KHỚP TAY với `DINH_DANG_HO_TRO` ở `src/knowledge/doc-text-extract.ts`.
 * Dashboard build riêng, không import được module backend - thêm định dạng
 * mới thì phải sửa cả hai chỗ.
 */
export const DINH_DANG_HO_TRO = ["txt", "md", "docx", "xlsx", "pdf"] as const;
