import { appendMessage } from "../conversation/history-store.js";
import { createLogger } from "../shared/logger.js";
import { dinhDangNeuBat, lamSachTheoCauHinh } from "./prepare-outgoing-text.js";
import { notifyTechnicalError, sendReplyInParts, type ReplyTarget } from "./send-reply-in-parts.js";

/**
 * Giao câu trả lời của agent xuống Zalo cho lượt chat THƯỜNG: làm sạch -> gửi
 * -> ghi history.
 *
 * Tách khỏi `message-turn-processor.ts` vì đó là phần ĐIỀU PHỐI cả lượt (mở
 * lượt, lưu ảnh, chốt usage, lưu trace, nhánh lỗi) - còn đây là một việc gọn:
 * biến chữ của model thành tin trên Zalo. File kia đã vượt ngưỡng 200 dòng khi
 * lớp làm sạch nối vào.
 *
 * KHÔNG dùng chung với scheduler: lượt theo lịch có luật `[SILENT]` riêng phải
 * chạy TRƯỚC bước làm sạch, và job hỏng thì im chứ không nhắn câu lỗi.
 */

const log = createLogger("message-turn");

export type KetQuaGiao = {
  /** Chữ THẬT SỰ đã tới Zalo - rỗng khi bị chặn hoặc không gửi được gì */
  daGui: string;
  /** Bị chặn vì rò system prompt, hoặc gửi hỏng giữa chừng */
  hong: boolean;
};

export async function deliverChatReply(
  target: ReplyTarget,
  accountId: string,
  threadId: string,
  text: string,
): Promise<KetQuaGiao> {
  // Lớp làm sạch CUỐI trước khi chữ ra Zalo. Hai đường khác nhau ở chỗ dấu
  // markdown bị XÓA hay được DỊCH thành định dạng thật của Zalo; lá chắn rò
  // system prompt và luật `[SILENT]` thì cả hai đều có.
  const sach = lamSachTheoCauHinh(text);

  if (sach.chan) {
    // Câu trả lời rò system prompt. Cắt bớt rồi gửi phần còn lại là gửi nửa
    // vời - không ai biết phần nào còn rò. Chặn hẳn, báo lỗi kỹ thuật.
    // 200 ký tự đầu để chẩn đoán, KHÔNG đổ nguyên prompt vào file log.
    log.error({ dauText: text.slice(0, 200) }, "Chặn câu trả lời rò system prompt - không gửi");
    await notifyTechnicalError(target);
    return { daGui: "", hong: true };
  }

  if (sach.daSua.length > 0) {
    // Sửa chữ của model rồi im lặng là tự bịt mắt mình lúc chẩn đoán
    log.warn({ daSua: sach.daSua }, "Đã làm sạch câu trả lời trước khi gửi");
  }

  // Dịch markdown thành `Style` của Zalo. Chữ TRẦN sau bước này mới là chữ
  // người dùng thấy, nên nó cũng là chữ ghi vào history bên dưới.
  const { text: chuGui, styles } = dinhDangNeuBat(sach.text);

  // Kiểm rỗng SAU khi dịch: câu chỉ toàn dấu markdown (vd đúng một hàng rào
  // code trống) còn chữ trước bước này nhưng rỗng sau, gửi đi là gửi tin trắng.
  if (!chuGui.trim()) {
    log.debug("Câu trả lời rỗng sau khi làm sạch - không gửi");
    return { daGui: "", hong: false };
  }

  // Tin dài bị Zalo chặn (error_code 118) nên phải cắt thành nhiều đoạn
  const reply = await sendReplyInParts(target, chuGui, styles);

  // Chỉ ghi phần ĐÃ gửi được: history phải khớp cái người dùng nhìn thấy. Ghi
  // chữ ĐÃ LÀM SẠCH chứ không phải chữ gốc - lệch thì lượt sau model đọc lại
  // history, thấy chính nó từng viết markdown và tưởng thế là được.
  if (reply.deliveredText) {
    appendMessage(accountId, threadId, { role: "assistant", content: reply.deliveredText });
  }

  // Gửi dở giữa chừng cũng phải nói, đừng để người ta ngồi đợi nốt phần sau
  if (reply.error) {
    await notifyTechnicalError(target);
    return { daGui: reply.deliveredText, hong: true };
  }

  return { daGui: reply.deliveredText, hong: false };
}
