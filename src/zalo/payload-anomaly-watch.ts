import { createLogger } from "../shared/logger.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

const log = createLogger("payload-anomaly");

/**
 * Cảnh báo khi payload Zalo không còn khớp giả định của parser.
 *
 * Vì sao cần: `parseIncomingMessage` moi payload thô bằng `any` - Zalo đổi tên
 * field thì TypeScript không bắt được, bot chỉ âm thầm ngừng thấy ảnh hoặc
 * ngừng nhận ra @mention. Tệ nhất là thiếu threadId: account-manager bỏ qua
 * luôn tin nhắn, không dấu vết gì trong log.
 *
 * Chỉ giữ 3 dấu hiệu chắc chắn sai, không đoán mò - tin sticker/hệ thống có
 * hình dạng content lạ là bình thường, cảnh báo bừa sẽ thành nhiễu rồi bị bỏ qua.
 */
const msgTypeOf = (parsed: ParsedMessage) => String(parsed.rawData?.msgType ?? "");

export function detectPayloadAnomalies(parsed: ParsedMessage): string[] {
  const anomalies: string[] = [];

  if (!parsed.threadId) {
    anomalies.push("thiếu threadId - tin nhắn bị bỏ qua hoàn toàn");
  }
  if (!parsed.senderId && !parsed.isSelf) {
    anomalies.push("thiếu uidFrom - không ghi được contact");
  }
  if (msgTypeOf(parsed).includes("photo") && parsed.images.length === 0) {
    anomalies.push("tin ảnh nhưng không moi được URL - có thể Zalo đã đổi tên field");
  }

  return anomalies;
}

// Payload hỏng thì hỏng với MỌI tin, log mỗi lần sẽ ngập file. Mỗi loại cảnh
// báo của mỗi account chỉ log lại sau 10 phút.
const THROTTLE_MS = 10 * 60_000;
const lastLoggedAt = new Map<string, number>();

/** Trả về những cảnh báo THỰC SỰ được log (đã lọc throttle) - để test kiểm được */
export function reportPayloadAnomalies(
  accountId: string,
  parsed: ParsedMessage,
  nowMs = Date.now(),
): string[] {
  const logged: string[] = [];

  for (const anomaly of detectPayloadAnomalies(parsed)) {
    const key = `${accountId}:${anomaly}`;
    const last = lastLoggedAt.get(key);
    if (last !== undefined && nowMs - last < THROTTLE_MS) continue;

    lastLoggedAt.set(key, nowMs);
    logged.push(anomaly);
    log.warn(
      { accountId, msgType: msgTypeOf(parsed), threadId: parsed.threadId || "(rỗng)" },
      `Payload Zalo không khớp giả định: ${anomaly}`,
    );
  }

  return logged;
}

/** Dùng trong test để mỗi ca chạy không dính throttle của ca trước */
export function resetAnomalyThrottle(): void {
  lastLoggedAt.clear();
}
