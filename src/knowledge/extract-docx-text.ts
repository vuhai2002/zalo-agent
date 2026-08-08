import { decodeHtmlEntities } from "../shared/html-entities.js";
import { readZipEntryText } from "../shared/read-zip-entry.js";

/**
 * `word/document.xml` -> chữ thuần, mỗi `<w:p>` (đoạn Word) thành một dòng.
 *
 * Đoạn mang `pStyle` "HeadingN" được đổi thành dòng markdown "#...# chữ" -
 * để `chunk-text.ts` nhận diện được tiêu đề bằng ĐÚNG luật nó đã dùng cho
 * .txt/.md: tài liệu Word có heading cũng được hưởng phép "giữ tiêu đề gần
 * nhất" như văn bản thường, không cần chunk-text biết gì về XML của docx.
 */

const HEADING_STYLE_RE = /<w:pStyle\s+w:val="Heading([1-9])"/;
const RUN_TEXT_RE = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
const PARAGRAPH_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;

function textOfParagraph(p: string): string {
  let raw = "";
  for (const m of p.matchAll(RUN_TEXT_RE)) raw += m[1];
  return decodeHtmlEntities(raw);
}

export async function extractDocxText(buf: Buffer): Promise<string> {
  // readZipEntryText đã ném lỗi tiếng Việt đọc được khi buf không phải zip
  // hợp lệ hoặc thiếu document.xml - không cần bọc thêm lớp lỗi ở đây.
  const xml = readZipEntryText(buf, "word/document.xml");

  const doan: string[] = [];
  for (const m of xml.matchAll(PARAGRAPH_RE)) {
    const p = m[0];
    const text = textOfParagraph(p).trim();
    if (!text) continue;

    const heading = HEADING_STYLE_RE.exec(p);
    doan.push(heading ? `${"#".repeat(Number(heading[1]))} ${text}` : text);
  }

  return doan.join("\n\n");
}
