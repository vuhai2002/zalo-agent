import type { API } from "zca-js";
import { runAgentTurn, type AgentTurnParams } from "../agent/agent-loop.js";
import { phanLoaiLoiProvider } from "../agent/provider-error-classifier.js";
import type { StepTrace } from "../agent/agent-step-trace.js";
import type { AccountConfig } from "../config/account-store.js";
import { appendMessage } from "../conversation/history-store.js";
import { persistBatchImages } from "../conversation/media-store.js";
import { idTinDangCho, layTinDangDo } from "../middleware/message-batcher.js";
import { maybeSummarizeThread } from "../conversation/thread-summarizer.js";
import { saveTurnTrace } from "../agent/agent-trace-store.js";
import { traceLuotHong } from "../agent/failed-turn-trace.js";
import { forLog } from "../agent/agent-step-observer.js";
import { finishAgentTurn, openAgentTurn } from "../conversation/usage-store.js";
import { createLogger } from "../shared/logger.js";
import { runInTurnLogContext } from "../shared/turn-log-context.js";
import { sendSeenReceipt } from "./message-receipts.js";
import { toZaloReaction } from "./reaction-icons.js";
import { ganAnhVaoHistory } from "./record-incoming-message.js";
import { trichDanTuTin } from "./reply-quote.js";
import { deliverChatReply } from "./deliver-chat-reply.js";
import { notifyTechnicalError, type ReplyTarget } from "./send-reply-in-parts.js";
import { startTypingIndicator } from "./typing-indicator.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

const log = createLogger("message-turn");

/**
 * Các điểm tiêm CHỈ dùng cho test - chạy thật thì bỏ trống hết và mỗi thứ tự
 * phân giải như cũ. Cùng nếp seam đã dùng ở `run-scheduled-job.ts`.
 */
type XuLyLuotOptions = {
  resolveModel?: AgentTurnParams["resolveModel"];
  /**
   * Lưu ảnh xuống đĩa. Có seam vì đường thật gọi mạng thẳng, mà bất biến "ảnh
   * của tin chen cũng được lưu" thì phải ghim được: thiếu nó là history chỉ còn
   * dòng chữ "[gửi kèm N ảnh]" và ảnh mất hẳn khi URL Zalo hết hạn.
   */
  persistImages?: typeof persistBatchImages;
};

/**
 * Báo cho người nhắn biết bot đã nhận: thả reaction vào tin vừa gửi.
 * Không await ở luồng chính và tự nuốt lỗi - reaction hỏng không được làm
 * chậm hay chết đường trả lời.
 */
function sendAutoReaction(config: AccountConfig, api: API, msg: ParsedMessage): void {
  if (!config.autoReactEnabled || !msg.msgId) return;
  void api
    .addReaction(toZaloReaction(config.autoReactIcon), {
      data: { msgId: msg.msgId, cliMsgId: msg.cliMsgId },
      threadId: msg.threadId,
      type: msg.threadType,
    })
    .catch((err) =>
      log.debug({ err }, "Auto-react thất bại"),
    );
}

/**
 * Xử lý 1 lượt: batch tin đã gộp -> agent -> trả lời xuống Zalo -> ghi history.
 * Được gọi từ message-batcher nên các lượt cùng thread luôn chạy tuần tự.
 *
 * Mở lượt TRƯỚC rồi mới chạy: có id ngay từ dòng log đầu tiên, và nhánh lỗi có
 * chỗ mà gắn trace vào. Toàn bộ phần xử lý chạy trong ngữ cảnh lượt để mọi dòng
 * log bên trong - kể cả log của các tool vốn tự tạo logger riêng - tự mang
 * accountId/threadId/turnId.
 */
export async function processBatch(
  config: AccountConfig,
  api: API,
  batch: ParsedMessage[],
  /**
   * Chỉ để TEST tiêm model giả - đúng seam `run-scheduled-job.ts` đang dùng.
   * Chạy thật thì bỏ trống và `runAgentTurn` tự phân giải như cũ.
   */
  options: XuLyLuotOptions = {},
): Promise<void> {
  const latest = batch[batch.length - 1]!;
  const turnId = openAgentTurn(config.id, latest.threadId);
  return runInTurnLogContext({ accountId: config.id, threadId: latest.threadId, turnId }, () =>
    xuLyLuot(config, api, batch, turnId, options),
  );
}

async function xuLyLuot(
  config: AccountConfig,
  api: API,
  batch: ParsedMessage[],
  turnId: number,
  options: XuLyLuotOptions,
): Promise<void> {
  const latest = batch[batch.length - 1]!;
  const threadKey = `${config.id}:${latest.threadId}`;
  const replyTarget: ReplyTarget = {
    api,
    threadKey,
    threadId: latest.threadId,
    threadType: latest.threadType,
    // Trích tin ĐẦU batch, không phải `latest`: đó là tin mở lượt, thường mang
    // câu hỏi chính, và không xê dịch khi có tin chen giữa lượt. Khác chỗ bám
    // của auto-react và biên nhận (cả hai nhắm `latest`) - cố ý, vì hai việc
    // khác nhau: reaction là phản hồi tin VỪA tới, trích dẫn là chỉ ra tin
    // ĐANG được trả lời. `trichDanTuTin` tự bỏ qua chat riêng.
    quote: trichDanTuTin(batch[0]!),
  };

  // Mảng do CHỖ NÀY sở hữu: agent-loop chỉ push vào. Lượt ném lỗi vẫn còn đủ
  // những step đã chạy được - trước đây mảng nằm trong agent-loop nên throw là
  // mất sạch, lượt chạy tốt 5 step rồi step 6 gặp 500 không để lại dấu vết nào.
  const trace: StepTrace[] = [];

  log.info(
    {
      from: latest.senderName,
      batchSize: batch.length,
      images: batch.reduce((sum, m) => sum + m.images.length, 0),
    },
    "Xử lý lượt tin nhắn",
  );

  // "Đã xem" cho cả lượt: bot bắt đầu xử lý = giống người mở hội thoại ra đọc.
  // Tin bị lọc (passive listen) không có bước này - báo đã xem rồi im lặng sẽ
  // khiến người nhắn tưởng bot đang soạn trả lời.
  sendSeenReceipt(api, batch);
  sendAutoReaction(config, api, latest);

  // Giữ "đang nhập" xuyên suốt: qua cả lượt LLM lẫn delay của rate-limiter,
  // dừng trong finally kể cả khi agent ném lỗi
  const stopTyping = config.typingIndicatorEnabled
    ? startTypingIndicator({
        send: (threadId, threadType) => api.sendTypingEvent(threadId, threadType),
        threadId: latest.threadId,
        threadType: latest.threadType,
      })
    : () => {};

  // Lượt đã chốt sổ (usage + trace) chưa. Nhánh catch dùng cờ này để không chốt
  // lần hai - xem giải thích ở đó.
  let turnFinished = false;

  const luuAnh = options.persistImages ?? persistBatchImages;

  /**
   * Tin người dùng nhắn thêm GIỮA lượt, đã được kéo vào ngữ cảnh của model.
   *
   * Mảng do CHỖ NÀY sở hữu, cùng nếp với `trace`: `runAgentTurn` chỉ lo đưa tin
   * vào input cho model, còn mọi hệ quả phụ - ghi history, báo "đã xem", thả
   * reaction, lưu ảnh - là việc ở đây. Không gom vào đây thì tin chen biến mất
   * khỏi history y như ca tin bị bỏ ở trần hàng chờ.
   */
  const tinChen: ParsedMessage[] = [];
  const layTinChen = async (): Promise<ParsedMessage[]> => {
    const moi = layTinDangDo(threadKey);
    if (moi.length === 0) return moi;
    tinChen.push(...moi);
    // Đối xử y hệt tin mở đầu lượt: người gửi phải thấy bot đã nhận, không thì
    // họ tưởng tin rơi vào khoảng không và gửi lại.
    sendSeenReceipt(api, moi);
    sendAutoReaction(config, api, moi[moi.length - 1]!);
    // AWAIT chứ không fire-and-forget: `localPath` phải có TRƯỚC khi dựng nội
    // dung cho model, và trước khi ghi history. Thiếu nó thì history chỉ còn
    // dòng chữ "[gửi kèm N ảnh]" mà không đường dẫn nào - lượt sau bot không
    // nạp lại được ảnh, sidecar phải mô tả lại từ đầu mỗi lần vì cache khóa
    // theo chính `localPath`, và ảnh coi như mất hẳn khi URL Zalo hết hạn.
    await luuAnh(config.id, moi);
    ganAnhVaoHistory(moi);
    return moi;
  };

  /**
   * Tin do TOOL gửi thẳng xuống Zalo trong lượt này (file, ảnh, tag).
   *
   * Ghi NGAY lúc gửi. Bản trước gom vào mảng rồi ghi ở cuối lượt, vì hồi đó tin
   * NGƯỜI DÙNG cũng ghi ở cuối - ghi thẳng thì tin tool nằm TRƯỚC tin người
   * dùng, sai thứ tự thật. Từ khi tin người dùng được ghi ngay lúc NHẬN
   * (`record-incoming-message.ts`), lý do đó không còn: gửi lúc nào ghi lúc
   * ấy là ra đúng thứ tự, và lượt chết giữa chừng cũng không đánh rơi.
   */
  const ghiNhanDaGui = (noiDung: string): void => {
    if (!noiDung.trim()) return;
    appendMessage(config.id, latest.threadId, { role: "assistant", content: noiDung.trim() });
  };

  try {
    // Lưu ảnh xuống data/media TRƯỚC lượt agent: agent đọc từ đĩa (khỏi tải 2
    // lần) và các lượt sau nạp lại được ảnh này từ history. Dòng lịch sử của
    // tin đã ghi từ lúc NHẬN, giờ mới có đường dẫn ảnh để gắn vào.
    await luuAnh(config.id, batch);
    ganAnhVaoHistory(batch);

    const result = await runAgentTurn({
      api,
      account: config,
      batch,
      trace,
      resolveModel: options.resolveModel,
      layTinChen,
      // Tin tới TRONG LÚC bot đang tải ảnh (ngay trên) đã vào lịch sử rồi, mà
      // lát nữa `layTinChen` lại kéo chính nó ra chèn kèm nhãn - loại khỏi phần
      // lịch sử để model không đọc hai lần
      layIdDangCho: () => idTinDangCho(threadKey),
      ghiNhanDaGui,
    });
    finishAgentTurn(turnId, result.usage);
    // Từ đây trở đi lượt đã CHỐT SỔ THẬT. Nhánh catch bên dưới không được chốt
    // lại nữa - xem giải thích ở đó.
    turnFinished = true;
    // Trace lưu ở đây chứ không trong agent-loop: chỗ này vốn đã là nơi chốt
    // usage của lượt, gom một mối cho dễ tìm.
    if (trace.length > 0) saveTurnTrace(turnId, trace);

    if (!result.text) {
      log.debug("Agent không trả text (có thể chỉ thả reaction)");
      return;
    }

    // Làm sạch + gửi + ghi history gói trong `deliverChatReply`. Lớp làm sạch
    // đặt ở tầng caller chứ không trong `sendReplyInParts`: hàm đó còn phục vụ
    // scheduler, mà lượt theo lịch có luật `[SILENT]` riêng - lọc chung sẽ phá
    // logic đó.
    const giao = await deliverChatReply(replyTarget, config.id, latest.threadId, result.text);
    if (giao.hong) return;

    // Memory lớp 2: gộp tin cũ vào summary - fire-and-forget sau khi đã trả lời,
    // maybeSummarizeThread tự nuốt lỗi nên không cần catch thêm
    void maybeSummarizeThread(config.id, latest.threadId);
  } catch (err) {
    // Tin của người dùng KHÔNG cần cứu ở đây nữa: đã vào lịch sử từ lúc nhận
    // (`record-incoming-message.ts`), nên lượt chết cách nào cũng không đánh
    // rơi. Trước đây nhánh này phải tự gọi `writeBatchToHistory`.
    //
    // Trace của những step ĐÃ chạy được là thứ quý nhất lúc này: lượt đi tốt 5
    // step rồi step 6 gặp 500 thì đây là toàn bộ manh mối. Trước đây nhánh này
    // không lưu gì nên lượt hỏng vừa không có trace vừa không lên trang Trace.
    // CHỈ chốt sổ khi lượt CHƯA từng chốt. `finishAgentTurn` là UPDATE thuần và
    // `saveTurnTrace` là INSERT, nên chạy lần hai sẽ ĐÈ MẤT số token thật bằng
    // {0,0,0} và NHÂN ĐÔI số dòng agent_steps. Ca đó có thật: mọi thứ sau
    // `finishAgentTurn` ở trên (lưu trace, ghi history, gửi tin) đều có thể ném
    // vì DB hoặc mạng, và lúc đó lượt ĐÃ chạy xong, đã tiêu token thật.
    // `run-scheduled-job.ts` đã có đúng lá chắn này; đường chat thì chưa.
    // Phân loại để chọn ĐÚNG câu báo. Một câu cho mọi thứ khiến "bot sai cấu
    // hình" (chờ bao lâu cũng không tự hết) đọc y hệt "mạng chập vài giây".
    const loaiLoi = phanLoaiLoiProvider(err);

    if (!turnFinished) {
      // Lượt chết TRƯỚC khi chạy được step nào (sai khóa, router 404, chưa cấu
      // hình) không có dòng `agent_steps` nào, mà `getRecentTurnsAllThreads`
      // INNER JOIN sang bảng đó - nên nó BIẾN MẤT khỏi trang Trace, đúng ca hỏng
      // phổ biến nhất của bản cài mới. Ghi một bước tổng hợp để lượt vừa lên
      // được danh sách vừa có thứ để đọc khi bấm vào.
      const buoc =
        trace.length > 0
          ? trace
          : [traceLuotHong({ loai: "loi-provider", loai_loi: loaiLoi, thongDiep: forLog(err, 300) })];
      saveTurnTrace(turnId, buoc);
      // Token thì KHÔNG biết - lỗi ném ra từ giữa lượt không mang theo usage -
      // nên để 0 và đọc số step trên trang Trace.
      finishAgentTurn(turnId, { inputTokens: 0, outputTokens: 0, totalTokens: 0, steps: trace.length });
    }
    log.error({ err, loaiLoi, steps: trace.length }, "Lỗi xử lý lượt tin nhắn");
    // Báo cho người nhắn thay vì im lặng bỏ treo. KHÔNG ghi câu này vào history:
    // nó là thông báo hệ thống, để lại chỉ khiến lượt sau model neo vào tiền lệ hỏng.
    await notifyTechnicalError(replyTarget, loaiLoi);
  } finally {
    stopTyping();
  }
}
