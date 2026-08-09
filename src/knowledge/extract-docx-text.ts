import { quetXmlTheoLuong } from "../shared/xml-sax-scan.js";
import { moPhienDocZip } from "../shared/zip-stream-entry.js";
import { taoDocxSaxBuilder } from "./docx-sax-paragraph-builder.js";

/**
 * `word/document.xml` -> chữ thuần, mỗi `<w:p>` (đoạn Word) hoặc mỗi bảng
 * thành một "đoạn", nối bằng "\n\n". Đoạn mang heading (qua `w:outlineLvl`
 * hoặc `pStyle` "HeadingN") được đổi thành dòng markdown "#...# chữ" - để
 * `chunk-text.ts` nhận diện được tiêu đề bằng ĐÚNG luật nó đã dùng cho
 * .txt/.md.
 *
 * Viết trên SAX (`docx-sax-paragraph-builder.ts`) qua luồng giải nén có trần
 * (`zip-stream-entry.ts`), THAY hẳn cặp regex `PARAGRAPH_RE`/`RUN_TEXT_RE` cũ.
 * Lý do: nghiên cứu đo được cặp regex đó là gốc của 3 lỗi Critical - ReDoS
 * bậc hai (bom 1,7 KB khoá event loop 38 giây), tab stop biến thành XML thô
 * (`<w:tab w:val="left" ...>` khớp nhầm `<w:t[^>]*>`), và bảng mất cấu trúc
 * hàng. Xem `plans/260809-remediation-kho-tri-thuc/reports/
 * nghien-cuu-doc-ooxml-an-toan.md` mục 1 cho từng ca hỏng đã đo trên file
 * Word thật.
 */
export async function extractDocxText(buf: Buffer): Promise<string> {
  const phien = moPhienDocZip(buf);
  const builder = taoDocxSaxBuilder();
  // moPhienDocZip/docEntryTheoLuong đã ném lỗi tiếng Việt đọc được khi buf
  // không phải zip hợp lệ, thiếu document.xml, hoặc vượt bất kỳ trần nào -
  // không cần bọc thêm lớp lỗi ở đây.
  await quetXmlTheoLuong(phien.docEntryTheoLuong("word/document.xml"), builder);

  const ketQua = builder.layDoanVanBan().join("\n\n");
  if (!ketQua.trim()) {
    // Trả chuỗi rỗng thì worker (kb-ingest-worker.ts) đánh dấu nguồn
    // "san_sang, 0 đoạn" - nguồn độc (docx chỉ toàn ảnh/đối tượng) trông như
    // nguồn khỏe mạnh. NÉM để nhánh "hong" của worker bắt được, đúng nguyên
    // tắc "extractor phải ném khi không trích được chữ nào".
    throw new Error(
      "Không đọc được chữ nào từ file docx (có thể chỉ chứa ảnh/đối tượng, không có văn bản)",
    );
  }
  return ketQua;
}
