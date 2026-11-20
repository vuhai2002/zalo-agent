import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { formatTimestamp } from "./user-message-line.js";

/**
 * Lời nhắc cho lượt có tin LẤY BÙ (tin người ta gửi lúc bot không nghe, Zalo gửi
 * lại khi kết nối - `src/zalo/offline-replay/`) trễ từ `nguongPhut` trở lên:
 * model mở đầu câu trả lời bằng MỘT câu vui xin lỗi vì trả lời muộn, trong CÙNG
 * tin trả lời.
 *
 * Model PHẢI được biết sự thật: hệ thống gián đoạn nên không nhận được tin, không
 * phải nó quên. Bản đầu giấu lý do ("chưa đọc được", "không nói chuyện kỹ thuật"),
 * ca thật 2026-11-20: bị hỏi "tại sao bạn phạm lỗi" thì model tự nhận "mình không
 * đặt lịch nhắc" và xin lỗi rối rít. Giọng vẫn vui (người dùng chốt: kiểu mới ngủ tỉnh
 * dậy - ví von cho gián đoạn; KHÔNG dùng "ngủ quên", nó là tự nhận lỗi, ngược sự thật), KHÔNG bịa bệnh hay sự cố cụ thể khác (hỏi "khỏe chưa?" là phải
 * bịa tiếp); bị hỏi lý do thì nói thật nhẹ nhàng. Bot chỉ gửi chữ của step CUỐI,
 * nên nhắc rõ câu xin lỗi nằm ở câu trả lời CHỐT; "sẽ xử lý ngay" chỉ khi chưa làm
 * xong được việc người ta nhờ (ý của người dùng).
 * Dòng tin lấy bù còn mang nhãn `NHAN_DEN_TRE` trong lịch sử nên các lượt SAU cũng
 * biết - lời nhắc này chỉ có ở lượt trả lời trễ.
 * `null` = không cần nhắc (không có tin lấy bù, hoặc chỉ trễ vài phút vì chớp mạng).
 */
export function loiNhacTraLoiTre(
  batch: ParsedMessage[],
  now: Date,
  nguongPhut: number,
  timeZone: string,
): string | null {
  let somNhat = Number.POSITIVE_INFINITY;
  for (const m of batch) {
    if (!m.layBu) continue;
    const luc = Date.parse(m.sentAt);
    if (Number.isFinite(luc) && luc < somNhat) somNhat = luc;
  }
  if (!Number.isFinite(somNhat) || now.getTime() - somNhat < nguongPhut * 60_000) return null;

  const moc = formatTimestamp(new Date(somNhat).toISOString(), timeZone);
  return (
    `[Lời nhắc hệ thống] Lúc các tin trên được gửi (sớm nhất ${moc}), hệ thống của bạn bị gián đoạn ` +
    "nên KHÔNG nhận được chúng; giờ chạy lại bạn mới nhận - bạn không hề quên hay bỏ qua. " +
    "Mở đầu câu trả lời CHỐT gửi người này bằng MỘT câu vui, tự nhiên xin lỗi vì trả lời muộn, xưng hô " +
    'như mọi khi với người này, ví von chuyện gián đoạn thành vừa ngủ một giấc dài mới tỉnh (ví dụ: "mình ' +
    'vừa tỉnh giấc", "mình mới ngủ đông dậy") - tự nói theo cách của mình, đừng chép y ví dụ. ' +
    "KHÔNG bịa bệnh hay sự cố cụ thể khác. Nếu người ta hỏi vì sao trả lời muộn thì nói thật, nhẹ nhàng: " +
    "hệ thống bên mình bị gián đoạn một lúc nên tin không tới được; đừng nhận là mình quên, cũng đừng xin " +
    "lỗi rối rít. Nếu chưa làm xong được việc người ta nhờ thì nói sẽ xử lý ngay. Sau câu đó trả lời đầy " +
    "đủ như bình thường."
  );
}
