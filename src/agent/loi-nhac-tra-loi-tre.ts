import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { formatTimestamp } from "./user-message-line.js";

/**
 * Lời nhắc cho lượt có tin LẤY BÙ (tin người ta gửi lúc bot không nghe, Zalo gửi
 * lại khi kết nối - `src/zalo/offline-replay/`) trễ từ `nguongPhut` trở lên:
 * model mở đầu câu trả lời bằng MỘT câu vui xin lỗi vì trả lời muộn, trong CÙNG
 * tin trả lời.
 *
 * Người dùng chốt: lý do mơ hồ kiểu ngủ quên / bận - KHÔNG bịa bệnh hay sự cố cụ
 * thể (người ta hỏi lại "khỏe chưa?" là phải bịa tiếp); ý "sẽ xử lý ngay" là của
 * người dùng. Bot chỉ gửi chữ của step CUỐI (chữ ở các step giữa bị bỏ), nên nhắc
 * rõ câu xin lỗi nằm ở câu trả lời CHỐT, và "sẽ xử lý ngay" chỉ khi chưa làm xong
 * được việc người ta nhờ - lúc gửi câu chốt thì việc đã làm xong rồi.
 * Xưng hô để model tự lo theo tên + lịch sử như mọi lượt. Mốc giờ là tin lấy bù
 * SỚM NHẤT của lượt, cùng định dạng nhãn dòng tin.
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
    `[Lời nhắc hệ thống] Các tin trên gửi lúc bạn chưa đọc được (sớm nhất ${moc}), giờ bạn mới thấy. ` +
    "Mở đầu câu trả lời CHỐT gửi người này bằng MỘT câu vui, tự nhiên xin lỗi vì trả lời muộn, " +
    "xưng hô như mọi khi với người này. Lý do mơ hồ kiểu ngủ quên, bận tối mắt; KHÔNG bịa bệnh hay " +
    "sự cố cụ thể, không nói chuyện kỹ thuật. Nếu chưa làm xong được việc người ta nhờ thì nói sẽ " +
    "xử lý ngay. Sau câu đó trả lời đầy đủ như bình thường."
  );
}
