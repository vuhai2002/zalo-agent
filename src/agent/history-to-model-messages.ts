import type { ModelMessage, UserContent } from "ai";
import type { StoredMessage } from "../conversation/history-store.js";
import { dongTinNguoiDung } from "./user-message-line.js";

/** Đọc ảnh đã lưu từ đĩa - inject được để test không cần filesystem */
export type StoredImageLoader = (relPath: string) => { base64: string; mediaType: string } | null;

/**
 * Tra mô tả text của ảnh (cache sidecar). Truyền vào = model chính không đọc
 * được ảnh: thay pixel bằng text mô tả, ảnh chưa có mô tả rơi về text sẵn có
 * "[gửi kèm N ảnh]". Không truyền = chế độ thường, đính pixel.
 */
export type ImageDescriptionLookup = (relPath: string) => string | null;

/**
 * Cách render ảnh history khi có sidecar:
 * - keepPixels=false (describe): chỉ text mô tả - model chính không đọc được ảnh.
 * - keepPixels=true (hybrid, cho combo): CẢ pixel LẪN mô tả - thành viên vision
 *   của combo thấy pixel, thành viên mù bị router lột pixel nhưng mô tả text
 *   sống sót nên vẫn biết ảnh chứa gì.
 */
export type HistoryImageRendering = {
  describe: ImageDescriptionLookup;
  keepPixels: boolean;
};

/**
 * Chia ngân sách ảnh từ tin mới nhất ngược lên: tin càng gần càng đáng được kèm
 * ảnh. Trả về map index tin -> số ảnh được lấy. Tách hàm để agent-loop biết
 * TRƯỚC những ảnh nào sắp vào context (cần mô tả trước khi build messages).
 */
export function planImageBudget(history: StoredMessage[], imageLimit: number): Map<number, number> {
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
  return imageBudgetByIndex;
}

/** Đường dẫn các ảnh history sẽ vào context theo ngân sách - để mô tả trước */
export function collectImagesWithinBudget(
  history: StoredMessage[],
  imageLimit: number,
): string[] {
  const plan = planImageBudget(history, imageLimit);
  const paths: string[] = [];
  for (const [index, take] of plan) {
    paths.push(...(history[index]!.images ?? []).slice(0, take));
  }
  return paths;
}

/**
 * Nhãn gắn trước tin của người KHÔNG có trong allowlist. Persona giải thích nhãn
 * này nghĩa là gì; ở đây chỉ lo gắn cho đúng chỗ.
 */
export const UNVERIFIED_TAG = "[chưa xác minh]";

export type SenderTrust = {
  isUnverified: (senderId?: string) => boolean;
};

/**
 * Dựng bộ kiểm tra từ cấu hình allowlist của account.
 *
 * Chế độ "all" trả về không-bao-giờ-đánh-dấu: chủ bot đã chủ động cho mọi người
 * nhắn, gắn nhãn lên tất cả thì nhãn mất hết ý nghĩa và chỉ tổ tốn token. Chỉ
 * chế độ "list" mới có khái niệm người-ngoài-danh-sách.
 */
export function senderTrustFrom(allowlist: { mode: "all" | "list"; userIds: string[] }): SenderTrust {
  if (allowlist.mode !== "list") return { isUnverified: () => false };
  const trong = new Set(allowlist.userIds);
  // Tin cũ lưu trước khi có cột sender_id không có id - không đoán bừa là người
  // lạ, vì gắn nhãn sai lên chính chủ bot còn tai hại hơn là bỏ sót
  return { isUnverified: (senderId?: string) => senderId !== undefined && !trong.has(senderId) };
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
  timeZone: string,
  rendering?: HistoryImageRendering,
  senderTrust?: SenderTrust,
): ModelMessage[] {
  const imageBudgetByIndex = planImageBudget(history, imageLimit);

  return history.map((message, index) => {
    if (message.role !== "user") {
      return { role: "assistant", content: message.content };
    }

    // Kèm thời gian gửi để model biết khoảng cách giữa các đoạn hội thoại
    // (người quay lại sau 3 ngày không bị nối chuyện như vừa nhắn xong).
    //
    // Người ngoài allowlist vẫn được ghi vào lịch sử (nhánh recordOnly và
    // groupPassiveListen) rồi phát lại cho model ở lượt sau. Không đánh dấu thì
    // chữ họ viết nằm trong lịch sử y hệt chữ của chủ bot - một tin soạn khéo
    // trong nhóm là đủ để thử điều khiển model ở lượt sau.
    const text = dongTinNguoiDung({
      createdAt: message.createdAt,
      timeZone,
      senderName: message.senderName,
      nhanChuaXacMinh: senderTrust?.isUnverified(message.senderId) ? UNVERIFIED_TAG : undefined,
      noiDung: message.content,
    });

    const take = imageBudgetByIndex.get(index) ?? 0;
    if (take === 0) return { role: "user", content: text };

    const parts: Exclude<UserContent, string> = [];
    for (const relPath of (message.images ?? []).slice(0, take)) {
      // describe/hybrid: kèm mô tả text từ cache sidecar (nếu đã có)
      if (rendering) {
        const description = rendering.describe(relPath);
        if (description) {
          parts.push({ type: "text", text: `[Mô tả ảnh đính kèm: ${description}]` });
        }
        // describe (keepPixels=false): model chính mù, pixel là rác tốn token
        if (!rendering.keepPixels) continue;
      }
      const image = loadImage(relPath);
      // Part "file" thay cho "image" - kiểu cũ bị AI SDK v7 deprecated
      if (image) parts.push({ type: "file", data: image.base64, mediaType: image.mediaType });
    }
    parts.push({ type: "text", text });
    // Toàn bộ file ảnh đã bị dọn / chưa có mô tả -> trả text thuần cho gọn payload
    return parts.length === 1 ? { role: "user", content: text } : { role: "user", content: parts };
  });
}
