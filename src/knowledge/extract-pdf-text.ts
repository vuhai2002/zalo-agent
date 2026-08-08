import { extractText, getDocumentProxy } from "unpdf";

/**
 * Đọc chữ từ PDF bằng `unpdf` (bọc pdfjs, không dependency runtime).
 *
 * `unpdf` KHÔNG ném lỗi khi PDF không có lớp chữ (ảnh quét) - nó trả chuỗi
 * rỗng - nên phải tự nhận diện ca này thay vì để caller thấy chuỗi rỗng rồi
 * tưởng tài liệu thật sự trống. PDF hỏng cấu trúc thì pdfjs ném lỗi tiếng
 * Anh thô ("Invalid PDF structure.") - bọc lại thành câu tiếng Việt để người
 * vận hành đọc được ở `kb_sources.loi`, không phải kỹ sư.
 */
export async function extractPdfText(buf: Buffer): Promise<string> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch (err) {
    const chiTiet = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF này hỏng, không đọc được: ${chiTiet}`);
  }

  if (!text.trim()) {
    throw new Error("PDF này là ảnh quét, chưa đọc được chữ (chưa hỗ trợ OCR)");
  }

  return text;
}
