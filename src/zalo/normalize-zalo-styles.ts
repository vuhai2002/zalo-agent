import { TextStyle, type Style } from "zca-js";

/**
 * Chuẩn hóa danh sách `Style` trước khi giao cho zca-js.
 *
 * VÌ SAO CÓ FILE NÀY - lỗi đã trả giá thật (2026-08-05, lượt 116): câu trả lời
 * có dòng tiêu đề chứa in đậm, ví dụ `## 1. Vé Tiền Giang - số **418512**`,
 * sinh ra HAI span `b` chồng nhau: một từ luật tiêu đề (phủ cả dòng) và một từ
 * luật inline (phủ riêng dãy số). Zalo từ chối CẢ TIN với mã 112 ("tham số
 * không hợp lệ"). Người dùng mất trọn câu trả lời sau 8 lượt tra web và 119k
 * token, chỉ nhận lại câu "trục trặc kỹ thuật".
 *
 * Đối chiếu 20 bước của 12 lượt gần đó: 9 tin gửi được đều có 0 span chồng
 * trùng loại; lượt hỏng có 3. Bản tham chiếu `zalo-personal` cũng phát
 * Big+Bold cho tiêu đề nên `f_18` vô can - nó chỉ chưa gặp ca tiêu đề có in
 * đậm bên trong.
 *
 * Module THUẦN: chỉ phụ thuộc kiểu của zca-js.
 */

/**
 * Khóa gộp: hai span chỉ gộp được khi CÙNG kiểu tô.
 *
 * `Indent` phải tính cả `indentSize` - hai cấp thụt khác nhau là hai định dạng
 * khác nhau, gộp lại là làm phẳng danh sách lồng.
 */
function khoaGop(s: Style): string {
  return s.st === TextStyle.Indent ? `${s.st}:${(s as { indentSize?: number }).indentSize ?? 1}` : s.st;
}

/**
 * Gộp span trùng loại bị chồng (hoặc chạm nhau) và sắp lại theo vị trí.
 *
 * Gộp cả ca CHẠM NHAU (`b.start === a.start + a.len`) chứ không chỉ ca chồng:
 * hai span liền kề cùng kiểu tô ra kết quả nhìn y hệt một span dài, nên gộp
 * làm ít span hơn mà không đổi thứ người dùng thấy.
 *
 * Sắp xếp: theo `start` tăng dần, cùng `start` thì span DÀI đứng trước. Trước
 * bản này span `Indent` bị phát SAU các span inline nên mảng không còn theo thứ
 * tự vị trí (`0:lst_1 7:b 13:lst_1 25:b 13:ind_$`). Chưa đo được Zalo có bắt
 * lỗi thứ tự hay không, nhưng gửi đi một mảng lộn xộn thì lúc có sự cố không ai
 * loại trừ được nó.
 */
export function chuanHoaStyles(styles: Style[]): Style[] {
  if (styles.length <= 1) return styles;

  const theoKhoa = new Map<string, Style[]>();
  for (const s of styles) {
    const k = khoaGop(s);
    const nhom = theoKhoa.get(k);
    if (nhom) nhom.push(s);
    else theoKhoa.set(k, [s]);
  }

  const ra: Style[] = [];
  for (const nhom of theoKhoa.values()) {
    nhom.sort((a, b) => a.start - b.start);
    let dangGom = { ...nhom[0]! };
    for (const s of nhom.slice(1)) {
      // CỐ Ý chỉ gộp span CHẠM hoặc CHỒNG nhau, không gộp qua ký tự xuống dòng.
      // Đã thử gộp span danh sách qua dòng để tiết kiệm byte: Zalo Web hiện
      // đúng nhưng Zalo trên điện thoại chỉ vẽ MỘT dấu đầu dòng cho cả span.
      // Giờ danh sách đi bằng chữ "- " thường nên không còn span nào để gộp.
      if (s.start <= dangGom.start + dangGom.len) {
        // Chồng hoặc chạm: nới đuôi ra tới điểm xa nhất của hai span
        const cuoi = Math.max(dangGom.start + dangGom.len, s.start + s.len);
        dangGom.len = cuoi - dangGom.start;
      } else {
        ra.push(dangGom);
        dangGom = { ...s };
      }
    }
    ra.push(dangGom);
  }

  return ra.sort((a, b) => a.start - b.start || b.len - a.len);
}
