import { extractXlsxSheets } from "./extract-xlsx-sheets.js";

/**
 * xlsx -> chữ theo HÀNG cho Kho tri thức (một hàng là một bản ghi có nghĩa:
 * tên hàng | giá | bảo hành). Dựng trên `extractXlsxSheets` (SAX, trần tổng,
 * thứ tự sheet theo workbook). Sheet ẩn hẳn (`veryHidden`) bị bỏ; sheet ẩn
 * thường vẫn đọc - người dùng Excel bỏ ẩn được bằng chuột phải.
 */
export async function extractXlsxText(buf: Buffer): Promise<string> {
  const doanTheoSheet = (await extractXlsxSheets(buf))
    .filter((s) => s.hienThi !== "an-han" && s.hang.length > 0)
    .map((s) => s.hang.map((h) => h.map((o) => o.giaTri).join(" | ")).join("\n"));

  const ketQua = doanTheoSheet.join("\n\n");
  if (!ketQua.trim()) {
    // Trả chuỗi rỗng thì nguồn thành "san_sang, 0 đoạn" - xem lý do đầy đủ ở
    // `extract-docx-text.ts` (cùng nguyên tắc, áp cho xlsx).
    throw new Error("Không đọc được chữ nào từ file xlsx (có thể mọi ô đều trống)");
  }
  return ketQua;
}
