import { streamText } from "ai";
import { chayStream } from "../agent/stream-text-result.js";
import { createLogger } from "../shared/logger.js";
import { db } from "./database.js";
import { getThreadSummary, setThreadSummary } from "./thread-store.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

const log = createLogger("thread-summarizer");

/**
 * Memory lớp 2 (compaction thu nhỏ của OpenClaw): tin cũ rớt khỏi cửa sổ replay
 * được gộp dần vào 1 summary per thread, inject lại vào system prompt - hội thoại
 * dài vẫn giữ được mạch mà không phình prompt.
 *
 * Chạy SAU khi bot đã trả lời (fire-and-forget) nên không làm chậm phản hồi;
 * lỗi summary không được phá lượt chat.
 */

// Tin thứ N mới nhất - mọi tin có id nhỏ hơn là "ngoài cửa sổ replay"
const windowStartStmt = db.prepare(
  `SELECT id FROM messages WHERE account_id = ? AND thread_id = ?
   ORDER BY id DESC LIMIT 1 OFFSET ?`,
);

const backlogStmt = db.prepare(
  `SELECT id, role, sender_name, content FROM messages
   WHERE account_id = ? AND thread_id = ? AND id > ? AND id < ?
   ORDER BY id`,
);

type BacklogRow = { id: number; role: string; sender_name: string | null; content: string };

/** Phần thuần (test được không cần LLM): gom tin đã rớt khỏi window mà summary chưa phủ */
export function collectSummaryBacklog(
  accountId: string,
  threadId: string,
): { backlog: BacklogRow[]; oldSummary: string; coversTo: number } {
  const { summary: oldSummary, coversTo } = getThreadSummary(accountId, threadId);

  const windowStart = windowStartStmt.get(accountId, threadId, getTuning("HISTORY_CONTEXT_LIMIT") - 1) as
    | { id: number }
    | undefined;
  if (!windowStart) return { backlog: [], oldSummary, coversTo };

  const backlog = backlogStmt.all(
    accountId,
    threadId,
    coversTo,
    windowStart.id,
  ) as unknown as BacklogRow[];
  return { backlog, oldSummary, coversTo };
}

/**
 * `truncated` = LLM chạm `maxOutputTokens` (finishReason 'length') -> bản tóm tắt
 * bị CẮT CỤT giữa chừng. KHÔNG được lưu bản cụt: nó sẽ ghi đè summary tốt + đẩy
 * `coversTo` tiến, đánh dấu đám tin đó "đã phủ" nên KHÔNG BAO GIỜ tóm tắt lại -
 * mất trí nhớ im lặng, vĩnh viễn. Trần mềm trong prompt khiến ca này hiếm; đây
 * là lưới đỡ cuối.
 */
export type SummaryResult = { text: string; truncated: boolean };
export type SummaryGenerator = (prompt: string) => Promise<SummaryResult>;

const defaultGenerator: SummaryGenerator = async (prompt) => {
  // Import động để tránh vòng import (llm-provider -> ... -> thread-store)
  const { resolveLanguageModel } = await import("../agent/llm-provider.js");
  // Streaming vì cùng lý do với lượt agent: router nằm sau Cloudflare, mà
  // Cloudflare cắt bằng 524 khi byte đầu chưa tới trong 100 giây (xem
  // `stream-text-result.ts`). Ở đây 1024 token nên hiếm khi chạm mốc đó, nhưng
  // hỏng ở đây là hỏng CÂM: `maybeSummarizeThread` nuốt lỗi, summary lặng lẽ
  // ngừng cập nhật và trí nhớ dài hạn của bot mòn dần mà không ai thấy. Giữ
  // đúng một bất biến "không còn lời gọi LLM non-stream nào" dễ hơn nhiều so
  // với việc nhớ chỗ nào được miễn.
  const result = await chayStream(
    (onError) =>
      streamText({
        model: resolveLanguageModel(),
        prompt,
        maxOutputTokens: 1024,
        maxRetries: 1,
        onError,
      }),
    (loi) => log.warn({ err: loi }, "streamText phát lỗi khi tóm tắt thread"),
  );
  // `finishReason === "length"` = chạm cap 1024 -> bản cụt. Báo lên để caller
  // KHÔNG lưu (giữ summary cũ còn nguyên vẹn).
  return { text: result.text.trim(), truncated: result.finishReason === "length" };
};

/**
 * Các MỤC cố định của bản tóm tắt, hợp domain chat cá nhân trên Zalo.
 *
 * Vì sao mục cố định thay vì "viết một đoạn tự do" (học từ COMPACTION_INSTRUCTION
 * của DeepSeek Harness): prompt tự do để LLM tự chọn giữ gì, và qua nhiều lần gộp
 * nó lặng lẽ đánh rơi một khía cạnh (vd quên "việc đã hứa"). Ép điền đủ mục, mục
 * rỗng ghi "(không có)" thì mất mát trở nên NHÌN THẤY được thay vì im lặng.
 * KHÔNG bê bộ mục coding của dsh (Files/Code/Errors) - vô nghĩa với bot chat.
 */
const MUC_TOM_TAT = [
  "NGƯỜI & QUAN HỆ: tên, vai trò, cách xưng hô, quan hệ với nhau",
  "QUYẾT ĐỊNH & ĐÃ HỨA: điều đã chốt, việc bot/người dùng đã hứa làm",
  "SỞ THÍCH & THÓI QUEN: điều thích/ghét, ràng buộc, cách muốn được đối xử",
  "VIỆC ĐANG DỞ: bối cảnh hiện tại, việc chưa xong, đang chờ gì",
  "CÂU HỎI TREO: điều người dùng hỏi mà chưa được trả lời trọn",
];

export function buildSummaryPrompt(oldSummary: string, backlog: BacklogRow[]): string {
  const lines = backlog.map((m) => {
    const name = m.role === "assistant" ? "Bot" : (m.sender_name ?? "Người dùng");
    return `${name}: ${m.content}`;
  });
  return [
    "Bạn đang duy trì bản tóm tắt một cuộc hội thoại Zalo dài để bot nhớ mạch chuyện.",
    "Gộp TÓM TẮT HIỆN TẠI và ĐOẠN HỘI THOẠI MỚI thành MỘT bản tóm tắt mới, tiếng Việt.",
    "",
    "Xuất ĐÚNG các mục sau theo thứ tự, mỗi mục vài gạch đầu dòng ngắn:",
    ...MUC_TOM_TAT.map((m) => `- ${m}`),
    "",
    "LUẬT:",
    '- Mục nào không có thông tin thì ghi "(không có)" - TUYỆT ĐỐI không bỏ mục.',
    "- Giữ NGUYÊN VĂN chỗ từ ngữ quan trọng: tên riêng, con số, ngày giờ, lời hứa.",
    "- Nếu người dùng ĐÍNH CHÍNH điều gì (vd tên, thông tin), ghi lại bản đã sửa.",
    "- Đã có TÓM TẮT HIỆN TẠI: giữ fact còn đúng, bỏ fact đã cũ/bị thay, HỢP NHẤT thông",
    "  tin mới vào - KHÔNG chép nguyên bản cũ, KHÔNG để hai bản chồng nhau.",
    "- Bỏ chào hỏi xã giao. Chỉ trả về nội dung tóm tắt, không mở bài, không kết luận.",
    "- Toàn bản GIỮ DƯỚI ~400 từ: ưu tiên fact quan trọng, cắt bớt chi tiết vụn. Thà",
    "  gọn mà đủ mục còn hơn dài rồi bị cắt cụt giữa chừng.",
    "",
    `TÓM TẮT HIỆN TẠI:\n${oldSummary || "(chưa có)"}`,
    "",
    `ĐOẠN HỘI THOẠI MỚI:\n${lines.join("\n")}`,
  ].join("\n");
}

/** Gọi sau mỗi lượt trả lời. Chỉ tốn 1 LLM call khi backlog đủ lớn. */
export async function maybeSummarizeThread(
  accountId: string,
  threadId: string,
  generate: SummaryGenerator = defaultGenerator,
): Promise<boolean> {
  try {
    const { backlog, oldSummary } = collectSummaryBacklog(accountId, threadId);
    if (backlog.length < getTuning("SUMMARY_TRIGGER_MESSAGES")) return false;

    const { text: newSummary, truncated } = await generate(buildSummaryPrompt(oldSummary, backlog));
    if (truncated) {
      // Bản cụt: KHÔNG ghi đè, KHÔNG tiến coversTo. Giữ summary cũ, lần sau thử
      // lại (backlog vẫn còn nguyên vì coversTo đứng yên).
      log.warn({ accountId, threadId }, "Tóm tắt bị cắt cụt ở token cap - bỏ, giữ bản cũ");
      return false;
    }
    if (!newSummary) return false;

    setThreadSummary(accountId, threadId, newSummary, backlog[backlog.length - 1]!.id);
    log.debug({ accountId, threadId, folded: backlog.length }, "Đã gộp tin cũ vào summary");
    return true;
  } catch (err) {
    // Summary hỏng không được ảnh hưởng lượt chat - lần sau thử lại
    log.warn({ accountId, threadId, err }, "Tóm tắt thread thất bại - bỏ qua");
    return false;
  }
}
