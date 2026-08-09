/**
 * Lọc ký tự HIỂN-THỊ-RỖNG (ASCII smuggling) khỏi văn bản.
 *
 * Dải chính: Unicode Tags (U+E0000-U+E007F) - kênh Riley Goodside (01/2024):
 * mỗi mã ánh xạ 1-1 sang một ký tự ASCII in được, RENDER RA RỖNG ở mọi trình
 * duyệt/terminal/editor - người vận hành xem tài liệu trên dashboard không
 * thấy gì - nhưng tokenizer của model vẫn đọc ra chữ, nên một chỉ thị giấu
 * trong dải này vẫn tới được model nguyên vẹn.
 *
 * Bốn ký tự lẻ bổ sung, đo được ở vòng rà soát an toàn (không thuộc dải Tags
 * nhưng cùng họ "operator không thấy gì trên dashboard"):
 *   - U+3164 HANGUL FILLER, U+115F HANGUL CHOSEONG FILLER: thuật toán ghép âm
 *     tiết Hangul cũ, không xuất hiện trong văn bản thường (tiếng Việt lẫn
 *     tiếng Hàn hiện đại).
 *   - U+2800 BRAILLE PATTERN BLANK: mẫu Braille RỖNG (không phải một mẫu chấm
 *     nào, chỉ là "trống").
 *   - U+1D41D MATHEMATICAL BOLD SMALL D: đo thực tế trên font dashboard hiện
 *     dùng - không có glyph, hiện gần như rỗng. CHỈ MỘT mã cụ thể đã đo, KHÔNG
 *     phải cả dải Mathematical Alphanumeric Symbols (U+1D400-U+1D7FF) - mở
 *     rộng thêm dải đó phải đo lại trước, đừng suy diễn.
 *
 * CHỈ lọc đúng các dải/mã trên, KHÔNG lọc `\p{Cf}` toàn cục hay chạy NFKC: đã
 * đo (xem `plans/260809-remediation-kho-tri-thuc/reports/nghien-cuu-injection-worker-rag.md`
 * mục "Câu hỏi 1") một bộ lọc rộng hơn phá emoji ghép ZWJ, ZWNJ (chữ trong tiếng
 * Ba Tư/Ấn), và biến thể Unicode hợp lệ khác. Đánh đổi DUY NHẤT của dải Tags là
 * cờ vùng con (Anh, Scotland, Wales dùng Tags để mã hoá mã vùng) - không liên
 * quan tới bot tiếng Việt.
 *
 * Module THUẦN: 0 import, không env, không DB.
 */

const KY_TU_AN_RE = /[\u{E0000}-\u{E007F}ㅤᅟ⠀\u{1D41D}]/gu;

/** Lọc ký tự hiển-thị-rỗng khỏi `text`. Không tìm thấy thì trả về CHÍNH `text` (không sao chép thừa). */
export function locKyTuAn(text: string): string {
  return KY_TU_AN_RE.test(text) ? text.replace(KY_TU_AN_RE, "") : text;
}
