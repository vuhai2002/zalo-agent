/**
 * Khai báo tối thiểu cho `word-extractor` 1.0.4 (gói không kèm types). Chỉ
 * khai phần repo dùng: đọc Buffer -> lấy thân văn bản.
 */
declare module "word-extractor" {
  interface WordDocument {
    getBody(): string;
  }
  export default class WordExtractor {
    extract(source: Buffer): Promise<WordDocument>;
  }
}
