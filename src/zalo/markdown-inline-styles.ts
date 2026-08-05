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
  const cat: { noiDung: string; style: TextStyle }[] = [];
  let tam = dong;
  for (const { regex, style } of CAP_DAU) {
    tam = tam.replace(regex, (_ca, noiDung: string) => {
      const n = cat.length;
      cat.push({ noiDung, style });
      return `${MOC}${n}${MOC}`;
    });
  }

  const spans: SpanInline[] = [];
  let ra = "";
  let i = 0;
  while (i < tam.length) {
    if (tam[i] !== MOC) {
      ra += tam[i++];
      continue;
    }
    const het = tam.indexOf(MOC, i + 1);
    const muc = het === -1 ? undefined : cat[Number(tam.slice(i + 1, het))];
    if (!muc) {
      // Token hỏng (không nên xảy ra) - giữ nguyên ký tự, KHÔNG nuốt chữ
      ra += tam[i++];
      continue;
    }
    spans.push({ start: ra.length, len: muc.noiDung.length, st: muc.style as SpanInline["st"] });
    ra += muc.noiDung;
    i = het + 1;
  }
  return { text: ra, spans };
}
