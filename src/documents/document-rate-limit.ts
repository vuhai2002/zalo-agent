import { env } from "../config/env.js";

/**
 * Trần số file mỗi thread được tạo trong 1 giờ. Bot đọc tin người lạ, mà dựng
 * file là việc tốn CPU nhất trong một lượt agent - không có trần thì một người
 * spam "xuất file" là ghim luôn tiến trình.
 *
 * Map tự dọn khi cửa sổ hết hạn: bài học rò rỉ Map theo thread ở V2.4 (giữ
 * entry cho mọi thread từng nhắn thì bộ nhớ phình vô hạn khi chạy dài ngày).
 */

/** Cửa sổ tính hạn mức - chính sách chống spam, không có "con số đúng" */
const WINDOW_MS = 60 * 60 * 1000;

/** threadKey -> mốc thời gian các lần tạo file còn trong cửa sổ */
const recentByThread = new Map<string, number[]>();

export type RateCheck = { ok: true } | { ok: false; reason: string };

export function checkDocumentRateLimit(threadKey: string, now = Date.now()): RateCheck {
  const cutoff = now - WINDOW_MS;
  const recent = (recentByThread.get(threadKey) ?? []).filter((at) => at > cutoff);

  if (recent.length >= env.DOCUMENT_MAX_PER_HOUR) {
    // Dọn luôn các thread khác đã nguội - tiện thể tránh phình Map
    pruneStaleThreads(cutoff);
    const waitMinutes = Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 60_000));
    return {
      ok: false,
      reason: `Đã tạo ${recent.length} file trong 1 giờ qua (trần ${env.DOCUMENT_MAX_PER_HOUR}). Thử lại sau khoảng ${waitMinutes} phút, hoặc trả lời trực tiếp trong chat thay vì gửi file.`,
    };
  }

  recent.push(now);
  recentByThread.set(threadKey, recent);
  pruneStaleThreads(cutoff);
  return { ok: true };
}

function pruneStaleThreads(cutoff: number): void {
  for (const [key, times] of recentByThread) {
    const alive = times.filter((at) => at > cutoff);
    if (alive.length === 0) recentByThread.delete(key);
    else if (alive.length !== times.length) recentByThread.set(key, alive);
  }
}

/** Chỉ dùng cho test - xóa toàn bộ trạng thái đếm */
export function resetDocumentRateLimit(): void {
  recentByThread.clear();
}
