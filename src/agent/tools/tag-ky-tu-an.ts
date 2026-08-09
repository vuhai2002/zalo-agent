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
 *   - U+3164 HANGUL FILLER, U+115F HANGUL CHOSEONG FILLER, U+1160 HANGUL
 *     JUNGSEONG FILLER, U+FFA0 HALFWIDTH HANGUL FILLER: BỐN filler còn lại
 *     của thuật toán ghép âm tiết Hangul cũ (đã chấp nhận giá làm hỏng chữ
 *     Hàn thì mua đủ cả họ, không dừng ở 2/4 như bản đầu) - không xuất hiện
 *     trong văn bản Hàn hiện đại (chữ Hàn THƯỜNG dùng âm tiết đã ghép sẵn,
 *     không dùng filler).
 *   - U+2800 BRAILLE PATTERN BLANK: đây là DẤU CÁCH của chữ Braille (không
 *     phải "mẫu rỗng vô nghĩa" như bản đầu ghi sai) - vẫn lọc vì nó hiện ra
 *     rỗng trên dashboard và là kênh smuggling đã biết, nhưng CÁI GIÁ THẬT là
 *     xoá nó làm CÁC TỪ BRAILLE DÍNH VÀO NHAU (mất dấu cách giữa từ), không
 *     phải "vô hại vì vốn dĩ vô nghĩa".
 *
 * KHÔNG lọc U+1D41D MATHEMATICAL BOLD SMALL D (có ở bản đầu, đã BỎ): vòng rà
 * soát đo được nó đổi NGHĨA khi nằm trong công thức toán (`𝐝x/𝐝t` đạo hàm
 * thành `x/t` phép chia bình thường) - không phải làm nhiễu như ASCII
 * smuggling. Và lý do "font dashboard thiếu glyph nên hiện rỗng" tự mâu
 * thuẫn: nếu font thật sự thiếu glyph cho khối U+1D400-U+1D7FF thì CẢ 1024 mã
 * trong khối đều rỗng như nhau, kẻ tấn công chỉ cần đổi sang một mã KHÁC
 * trong cùng khối (vd U+1D41E) là né được bộ lọc - lọc một mã lẻ giữa 1024 mã
 * không phải một bộ lọc, chỉ là ảo giác an toàn.
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

const KY_TU_AN_RE = /[\u{E0000}-\u{E007F}ㅤᅟᅠﾠ⠀]/gu;

/** Lọc ký tự hiển-thị-rỗng khỏi `text`. Không tìm thấy thì trả về CHÍNH `text` (không sao chép thừa). */
export function locKyTuAn(text: string): string {
  return KY_TU_AN_RE.test(text) ? text.replace(KY_TU_AN_RE, "") : text;
}
