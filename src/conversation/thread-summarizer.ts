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

export type SummaryGenerator = (prompt: string) => Promise<string>;

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
  return result.text.trim();
};

function buildSummaryPrompt(oldSummary: string, backlog: BacklogRow[]): string {
  const lines = backlog.map((m) => {
    const name = m.role === "assistant" ? "Bot" : (m.sender_name ?? "Người dùng");
    return `${name}: ${m.content}`;
  });
  return [
    "Bạn đang duy trì bản tóm tắt một cuộc hội thoại Zalo dài để bot nhớ mạch chuyện.",
    "Gộp TÓM TẮT HIỆN TẠI và ĐOẠN HỘI THOẠI MỚI thành tóm tắt mới, tiếng Việt, tối đa 300 từ.",
    "Giữ: tên người, quyết định, sở thích, việc đã hứa, thông tin cá nhân quan trọng. Bỏ: chào hỏi xã giao.",
    "Chỉ trả về nội dung tóm tắt, không mở bài.",
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

    const newSummary = await generate(buildSummaryPrompt(oldSummary, backlog));
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
