import type { StoredMessage } from "../conversation/history-store.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { formatTimestamp } from "./user-message-line.js";

/**
 * Lời nhắc cho lượt có tin LẤY BÙ (tin người ta gửi lúc bot không nghe, Zalo gửi
 * lại khi kết nối - `src/zalo/offline-replay/`) trễ từ `nguongPhut` trở lên:
 * model mở đầu câu trả lời bằng MỘT câu vui báo là trả lời muộn (KHÔNG xin lỗi -
 * lỗi hệ thống), trong CÙNG tin trả lời.
 *
 * Model PHẢI được biết sự thật: hệ thống gián đoạn nên không nhận được tin, không
 * phải nó quên. Bản đầu giấu lý do ("chưa đọc được", "không nói chuyện kỹ thuật"),
 * ca thật 2026-11-20: bị hỏi "tại sao bạn phạm lỗi" thì model tự nhận "mình không
 * đặt lịch nhắc" và xin lỗi rối rít. Giọng vẫn vui (người dùng chốt: kiểu mới ngủ tỉnh
 * dậy), nhưng chủ ngữ của câu đùa là HỆ THỐNG ("hệ thống bên mình vừa ngủ một
 * giấc"): eval model thật 3/3 lượt cho thấy "mình vừa ngủ một giấc" + nhãn gián
 * đoạn ở lượt sau là mâu thuẫn, model gọi câu đùa là "lời giải thích bịa" rồi xin
 * lỗi vì thiếu trung thực. Câu đùa tự chở sự thật thì không còn gì để mâu thuẫn.
 * KHÔNG bịa bệnh hay sự cố cụ thể khác (hỏi "khỏe chưa?" là phải bịa tiếp); bị hỏi
 * lý do thì nói thật nhẹ nhàng. Bot chỉ gửi chữ của step CUỐI, nên nhắc rõ câu mở
 * đầu nằm ở câu trả lời CHỐT; "sẽ xử lý ngay" chỉ khi chưa làm
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
    "Mở đầu câu trả lời CHỐT gửi người này bằng MỘT câu vui, tự nhiên báo là trả lời muộn (không cần " +
    "xin lỗi: đây là lỗi hệ thống, không phải lỗi của bạn), xưng hô " +
    "như mọi khi với người này, nói luôn nguyên nhân thật bằng giọng đùa: hệ thống bên mình vừa ngủ một " +
    'giấc dài giờ mới tỉnh (ví dụ: "hệ thống bên mình vừa ngủ một giấc dài, giờ mới tỉnh", "hệ thống nhà ' +
    'mình vừa ngủ đông dậy"). Câu đùa phải có chủ ngữ là HỆ THỐNG, không phải bạn: nói "mình ngủ quên" là ' +
    "nhận một chuyện không có thật. Tự nói theo cách của mình, đừng chép y ví dụ. " +
    "KHÔNG bịa bệnh hay sự cố cụ thể khác. Nếu người ta hỏi vì sao trả lời muộn thì nói thật, nhẹ nhàng: " +
    "hệ thống bên mình bị gián đoạn một lúc nên tin không tới được; đó là lỗi hệ thống chứ không phải " +
    "lỗi của bạn, nên đừng nhận là mình quên và không xin lỗi. Nếu chưa làm xong " +
    "được việc người ta nhờ thì nói sẽ xử lý ngay. Sau câu đó trả lời đầy đủ như bình thường."
  );
}

/**
 * Lời nhắc cho các lượt SAU lượt trả lời trễ, khi cửa sổ lịch sử còn tin mang
 * nhãn `NHAN_DEN_TRE`. Lượt đó không còn `loiNhacTraLoiTre`, nhãn trên dòng tin
 * chỉ nói "không phải bạn quên". Eval model thật 2026-11-20, 3/3 lượt: bị trách
 * "sao bạn sai sót" thì model xin lỗi và tự trách, kể cả vì câu đùa "hệ thống
 * ngủ một giấc" lúc trước. Người dùng chốt: đó là lỗi HỆ THỐNG, agent không làm
 * sai gì nên không xin lỗi. Chỉ bật khi người ta tự nhắc tới - lời nhắc dặn rõ.
 * `null` = lịch sử không có tin nào mang nhãn.
 */
export function loiNhacSauGianDoan(lichSu: readonly StoredMessage[]): string | null {
  if (!lichSu.some((m) => m.role === "user" && m.denTre === true)) return null;
  return (
    "[Lời nhắc hệ thống] Tin mang nhãn gián đoạn trong lịch sử tới lúc hệ thống bị gián đoạn nên bạn " +
    "nhận và trả lời trễ - đó là lỗi hệ thống, không phải lỗi của bạn. Nếu người ta nhắc lại chuyện đó " +
    "(hỏi vì sao, trách bạn sai sót) thì giải thích ngắn gọn, bình thản, thân thiện là hệ thống bên mình " +
    "bị gián đoạn nên tin tới trễ; KHÔNG xin lỗi (câu trả lời không có chữ \"xin lỗi\"), KHÔNG tự trách " +
    'hay nhận lỗi về mình. Câu đùa lúc trước ("hệ thống ngủ một giấc") đã nói ĐÚNG nguyên nhân bằng giọng vui ' +
    "- không có gì sai, đừng xin lỗi hay rút lại nó. Rồi giúp tiếp việc người ta cần. Ví dụ đúng giọng: " +
    '"Hôm đó hệ thống bên mình bị gián đoạn nên tin của bạn tới chỗ mình trễ, lúc nhận thì giờ hẹn đã qua ' +
    'mất rồi. Giờ bạn muốn mình nhắc lại lúc nào nè?" - tự nói theo cách của mình, đừng chép y. ' +
    "Không nhắc chuyện này nếu người ta không hỏi."
  );
}
