/**
 * Lọc dải Unicode Tags (U+E0000-U+E007F) khỏi văn bản.
 *
 * Đây là kênh "ASCII smuggling" (Riley Goodside, 01/2024): mỗi mã trong dải
 * ánh xạ 1-1 sang một ký tự ASCII in được, RENDER RA RỖNG ở mọi trình duyệt/
 * terminal/editor - người vận hành xem tài liệu trên dashboard không thấy gì -
 * nhưng tokenizer của model vẫn đọc ra chữ, nên một chỉ thị giấu trong dải này
 * vẫn tới được model nguyên vẹn.
 *
 * CHỈ lọc đúng dải này, KHÔNG lọc `\p{Cf}` toàn cục hay chạy NFKC: đã đo (xem
 * `plans/260809-remediation-kho-tri-thuc/reports/nghien-cuu-injection-worker-rag.md`
 * mục "Câu hỏi 1") một bộ lọc rộng hơn phá emoji ghép ZWJ, ZWNJ (chữ trong tiếng
 * Ba Tư/Ấn), và biến thể Unicode hợp lệ khác. Đánh đổi DUY NHẤT của dải Tags là
 * cờ vùng con (Anh, Scotland, Wales dùng Tags để mã hoá mã vùng) - không liên
 * quan tới bot tiếng Việt.
 *
 * Module THUẦN: 0 import, không env, không DB.
 */

const DAI_TAGS_RE = /[\u{E0000}-\u{E007F}]/gu;

/** Lọc dải Tags khỏi `text`. Không tìm thấy thì trả về CHÍNH `text` (không sao chép thừa). */
export function locKyTuAn(text: string): string {
  return DAI_TAGS_RE.test(text) ? text.replace(DAI_TAGS_RE, "") : text;
}
