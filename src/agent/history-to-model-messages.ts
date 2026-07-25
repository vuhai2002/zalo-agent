import type { ModelMessage, UserContent } from "ai";
import type { StoredMessage } from "../conversation/history-store.js";

/** Đọc ảnh đã lưu từ đĩa - inject được để test không cần filesystem */
export type StoredImageLoader = (relPath: string) => { base64: string; mediaType: string } | null;

/** "[25/07 14:30]" theo giờ máy chạy bot - đủ cho model cảm nhận khoảng cách thời gian */
export function formatTimestamp(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `[${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}]`;
}

/**
 * History -> ModelMessage, kèm lại tối đa `imageLimit` ảnh gần nhất để model
 * xem lại được ảnh cũ ("group trên ảnh tên gì?" sau khi gửi ảnh vài phút).
 * Ảnh ngoài ngân sách (hoặc file đã bị dọn) rơi về text sẵn có "[gửi kèm N ảnh]".
 */
export function historyToModelMessages(
  history: StoredMessage[],
  imageLimit: number,
  loadImage: StoredImageLoader,
): ModelMessage[] {
  // Chia ngân sách từ tin mới nhất ngược lên: tin càng gần càng đáng được kèm ảnh
  const imageBudgetByIndex = new Map<number, number>();
  let budget = imageLimit;
  for (let i = history.length - 1; i >= 0 && budget > 0; i--) {
    const message = history[i]!;
    const count = message.role === "user" ? (message.images?.length ?? 0) : 0;
    if (count === 0) continue;
    const take = Math.min(count, budget);
    imageBudgetByIndex.set(i, take);
    budget -= take;
  }

  return history.map((message, index) => {
    if (message.role !== "user") {
      return { role: "assistant", content: message.content };
    }

    // Kèm thời gian gửi để model biết khoảng cách giữa các đoạn hội thoại
    // (người quay lại sau 3 ngày không bị nối chuyện như vừa nhắn xong)
    const ts = message.createdAt ? formatTimestamp(message.createdAt) : "";
    const name = message.senderName ? `${message.senderName}: ` : "";
    const text = `${ts} ${name}${message.content}`.trim();

    const take = imageBudgetByIndex.get(index) ?? 0;
    if (take === 0) return { role: "user", content: text };

    const parts: Exclude<UserContent, string> = [];
    for (const relPath of (message.images ?? []).slice(0, take)) {
      const image = loadImage(relPath);
      // Part "file" thay cho "image" - kiểu cũ bị AI SDK v7 deprecated
      if (image) parts.push({ type: "file", data: image.base64, mediaType: image.mediaType });
    }
    parts.push({ type: "text", text });
    // Toàn bộ file ảnh đã bị dọn -> trả text thuần cho gọn payload
    return parts.length === 1 ? { role: "user", content: text } : { role: "user", content: parts };
  });
}
