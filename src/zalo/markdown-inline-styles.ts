import { TextStyle } from "zca-js";

/**
 * Dịch các cặp dấu INLINE (`**đậm**`, `~~gạch~~`, `` `code` ``) của MỘT dòng.
 *
 * Tách khỏi `markdown-to-zalo-styles.ts` không phải để cho gọn: file kia lo
 * việc theo DÒNG (tiền tố khối, hàng rào code, cộng dồn con trỏ toàn cục), còn
 * đây là một mối quan tâm khép kín - nhận một dòng, trả về dòng đã bóc dấu kèm
 * span tương đối. Ranh giới đó cũng là ranh giới của cái bẫy mô tả bên dưới.
 *
 * Module THUẦN: chỉ phụ thuộc enum của zca-js.
 */

/** Ký tự mốc để token hóa - xem `apDungInline` */
export const MOC = "\u0001";

/**
 * Các cặp dấu inline được dịch.
 *
 * CỐ Ý BỎ `__đậm__` và `_nghiêng_`: dấu gạch dưới sống đầy trong tên file và
 * URL thật (`bao_gia_2026.pdf`), bắt chúng là đổi hỏng dữ liệu thật. Đây là
 * quyết định đã có từ `sanitize-reply-text.ts`, giữ nguyên.
 *
 * MỌI biểu thức ở đây phải TUYẾN TÍNH - bot đọc tin của người lạ, một tin soạn
 * khéo khiến model nhại lại chuỗi độc là đủ để biểu thức bậc hai treo cả tiến
 * trình. Lượng từ đều đi kèm lớp ký tự PHỦ ĐỊNH (`[^*\n]`) nên không backtrack
 * chồng nhau được. Cùng luật với `sanitize-reply-text.ts`.
 *
 * Thứ tự QUAN TRỌNG: dấu dài đứng trước dấu ngắn, không thì `**` bị `*` ăn mất.
 */
const CAP_DAU: { regex: RegExp; style: TextStyle }[] = [
  { regex: /\*\*\*([^*\n]+)\*\*\*/g, style: TextStyle.Bold }, // Zalo không chồng được đậm+nghiêng
  { regex: /\*\*([^*\n]+)\*\*/g, style: TextStyle.Bold },
  { regex: /~~([^~\n]+)~~/g, style: TextStyle.StrikeThrough },
  { regex: /`([^`\n]+)`/g, style: TextStyle.Bold }, // Zalo không có font mono
  { regex: /(?<![*\w])\*(?!\*)([^*\n]+?)\*(?!\*)(?!\w)/g, style: TextStyle.Italic },
  // Màu và gạch chân: markdown KHÔNG có cú pháp cho hai thứ này nên phải tự đặt
  // quy ước. Dùng thẻ kiểu HTML vì model quen viết, và vì lớp ký tự phủ định
  // `[^<\n]` giữ biểu thức tuyến tính - không thẻ nào lồng trong thẻ nào được,
  // đó cũng chính là điều mình muốn (tô hai màu chồng nhau là vô nghĩa).
  //
  // Đây thuần là DỮ LIỆU, không phải code do model sinh ra, nên không mở thêm
  // đường prompt injection - cùng nguyên tắc với tool tạo file.
  //
  // Cả 4 màu + gạch chân đã ĐO THẬT trên cả Zalo Web lẫn điện thoại: hiện y hệt
  // nhau, kể cả khi chồng với đậm hoặc nghiêng.
  { regex: /<do>([^<\n]+)<\/do>/gi, style: TextStyle.Red },
  { regex: /<cam>([^<\n]+)<\/cam>/gi, style: TextStyle.Orange },
  { regex: /<vang>([^<\n]+)<\/vang>/gi, style: TextStyle.Yellow },
  { regex: /<xanh>([^<\n]+)<\/xanh>/gi, style: TextStyle.Green },
  { regex: /<gach>([^<\n]+)<\/gach>/gi, style: TextStyle.Underline },
];

export type SpanInline = { start: number; len: number; st: Exclude<TextStyle, TextStyle.Indent> };

/**
 * Dịch phần inline của MỘT dòng.
 *
 * Cách ngây thơ - chạy từng regex rồi phát span theo độ dài kết quả - VỠ khi
 * pass sau xóa ký tự nằm TRƯỚC span mà pass trước đã ghi: span cũ trôi đi mà
 * không ai chỉnh lại. Bản tham chiếu đã dính thật, ca đo được là
 * `__Chữ gạch chân__` hóa ra chỉ gạch chân `ữ gạch chân.`.
 *
 * Nên: mỗi pass thay đoạn khớp bằng token `MOC + số + MOC` và cất nội dung ra
 * ngoài. Token có độ dài KHÔNG phụ thuộc số ký tự các pass khác xóa, và các
 * regex sau không khớp vào token được. Xong hết mới đi một vòng cuối dựng lại
 * chuỗi và phát span theo offset CUỐI CÙNG.
 */
export function apDungInline(dong: string): { text: string; spans: SpanInline[] } {
  const cat: MucDaCat[] = [];
  const tam = tokenHoa(dong, cat);

  // Nội dung cất ra ở pass TRƯỚC không được các pass SAU quét tới, nên phải
  // token hóa lại chính nó. Ví dụ `**<cam>X</cam>**`: pass đậm cất nguyên
  // `<cam>X</cam>` vào kho rồi pass màu chỉ còn thấy token ở ngoài, thẻ màu nằm
  // trong kho thành chữ trần. Vòng này quét cả những mục MỚI sinh ra (`cat` dài
  // thêm trong lúc lặp) và dừng chắc chắn vì nội dung mỗi lần một ngắn đi.
  for (let k = 0; k < cat.length; k++) {
    cat[k]!.noiDung = tokenHoa(cat[k]!.noiDung, cat);
  }

  const spans: SpanInline[] = [];
  const text = moRong(tam, cat, 0, spans);
  return { text, spans };
}

type MucDaCat = { noiDung: string; style: TextStyle };

/** Thay mọi đoạn khớp bằng token, cất nội dung vào `cat`. Trả chuỗi đã token hóa. */
function tokenHoa(chuoi: string, cat: MucDaCat[]): string {
  let tam = chuoi;
  for (const { regex, style } of CAP_DAU) {
    tam = tam.replace(regex, (_ca, noiDung: string) => {
      const n = cat.length;
      cat.push({ noiDung, style });
      return `${MOC}${n}${MOC}`;
    });
  }
  return tam;
}

/**
 * Dựng lại chuỗi từ token và phát span theo offset CUỐI CÙNG.
 *
 * ĐỆ QUY vì thẻ lồng nhau là ca thường gặp nhất của màu: `<cam>**Thời gian:**</cam>`
 * phải ra HAI span cùng phủ "Thời gian:" - một cam, một đậm. Bản một tầng chỉ
 * phát được span ngoài, còn dấu `**` bên trong lọt ra thành chữ.
 */
function moRong(chuoi: string, cat: MucDaCat[], goc: number, spans: SpanInline[]): string {
  let ra = "";
  let i = 0;
  while (i < chuoi.length) {
    if (chuoi[i] !== MOC) {
      ra += chuoi[i++];
      continue;
    }
    const het = chuoi.indexOf(MOC, i + 1);
    const muc = het === -1 ? undefined : cat[Number(chuoi.slice(i + 1, het))];
    if (!muc) {
      // Token hỏng (không nên xảy ra) - giữ nguyên ký tự, KHÔNG nuốt chữ
      ra += chuoi[i++];
      continue;
    }
    const batDau = goc + ra.length;
    const trong = moRong(muc.noiDung, cat, batDau, spans);
    spans.push({ start: batDau, len: trong.length, st: muc.style as SpanInline["st"] });
    ra += trong;
    i = het + 1;
  }
  return ra;
}
