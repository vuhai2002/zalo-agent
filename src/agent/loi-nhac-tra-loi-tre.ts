import { getDateTimeParts } from "../shared/current-datetime.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

/**
 * Lời nhắc cho lượt có tin LẤY BÙ (tin người ta gửi lúc bot không nghe, Zalo gửi
 * lại khi kết nối - `src/zalo/offline-replay/`) trễ từ `nguongPhut` trở lên:
 * model mở đầu bằng MỘT câu vui xin lỗi vì trả lời muộn, trong CÙNG tin trả lời.
 *
 * Người dùng chốt: lý do mơ hồ kiểu ngủ quên / bận - KHÔNG bịa bệnh hay sự cố cụ
 * thể (người ta hỏi lại "khỏe chưa?" là phải bịa tiếp). Xưng hô để model tự lo
 * theo tên + lịch sử như mọi lượt. Mốc giờ là tin lấy bù SỚM NHẤT của lượt.
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

  const { date, time } = getDateTimeParts(timeZone, new Date(somNhat));
  return (
    `[Lời nhắc hệ thống] Các tin trên gửi lúc bạn chưa đọc được (sớm nhất ${time} ${date.slice(0, 5)}), ` +
    "giờ bạn mới thấy. Mở đầu câu trả lời bằng MỘT câu vui, tự nhiên xin lỗi vì trả lời muộn, " +
    "xưng hô như mọi khi với người này. Lý do mơ hồ kiểu ngủ quên, bận tối mắt; KHÔNG bịa bệnh hay " +
    "sự cố cụ thể, không nói chuyện kỹ thuật. Việc cần làm lâu thì nói đợi chút. Sau câu đó trả lời " +
    "đầy đủ như bình thường."
  );
}
