import { extractDocxText } from "./extract-docx-text.js";
import { extractPdfText } from "./extract-pdf-text.js";
import { extractXlsxText } from "./extract-xlsx-text.js";

/** 5 định dạng nguồn Kho tri thức đọc được chữ. */
export const DINH_DANG_HO_TRO = ["txt", "md", "docx", "xlsx", "pdf"] as const;
export type DinhDangKb = (typeof DINH_DANG_HO_TRO)[number];

export function laDinhDangHoTro(x: string): x is DinhDangKb {
  return (DINH_DANG_HO_TRO as readonly string[]).includes(x);
}

/**
 * Đọc chữ thô từ file theo định dạng, để `chunk-text.ts` cắt đoạn ngay sau.
 *
 * Ném lỗi có câu tiếng Việt đọc được khi file hỏng - caller (worker xử lý
 * nguồn, phase 05) bắt lại rồi ghi thẳng vào `kb_sources.loi` cho người vận
 * hành đọc, không phải kỹ sư. Mỗi extractor tự chịu trách nhiệm dịch lỗi thư
 * viện (zip hỏng, PDF hỏng, PDF ảnh quét) sang câu tiếng Việt tương ứng - hàm
 * này chỉ điều phối theo định dạng, không bọc thêm một lớp lỗi chung chung
 * (tránh lỗi hiện hai lần, một từ extractor một từ đây).
 */
export async function docChuTuFile(buf: Buffer, dinhDang: DinhDangKb): Promise<string> {
  switch (dinhDang) {
    case "txt":
    case "md":
      return buf.toString("utf-8");
    case "docx":
      return extractDocxText(buf);
    case "xlsx":
      return extractXlsxText(buf);
    case "pdf":
      return extractPdfText(buf);
  }
}
