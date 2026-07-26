import type { ModelMessage, UserContent } from "ai";
import { env } from "../config/env.js";
import { isSidecarConfigured } from "../config/runtime-vision-settings.js";
import type { StoredMessage } from "../conversation/history-store.js";
import { getImageDescription } from "../conversation/image-description-store.js";
import { loadStoredImage } from "../conversation/media-store.js";
import { downloadImageAsBase64 } from "../shared/download-image.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import {
  collectImagesWithinBudget,
  historyToModelMessages,
  type HistoryImageRendering,
} from "./history-to-model-messages.js";
import type { ModelOverride } from "./llm-provider.js";
import { classifyModelVision } from "./model-vision-detection.js";
import { describeImage, ensureDescriptionsFor } from "./vision-sidecar.js";

/**
 * Dựng input cho 1 lượt agent theo 4 chế độ ảnh (mô hình auto|native|text của
 * Hermes, thêm blind khi không có sidecar và hybrid cho combo của 9Router):
 *
 * - native:   model chính đọc được ảnh - đính pixel như trước giờ.
 * - describe: model chính KHÔNG đọc được ảnh nhưng có sidecar - thay pixel
 *             bằng text mô tả (sidecar mô tả 1 lần, cache DB).
 * - hybrid:   model là COMBO trộn thành viên có/không vision - đính CẢ pixel
 *             LẪN mô tả: thành viên vision thấy pixel, lượt rơi vào thành viên
 *             mù (fallback, hoặc ảnh history không kích hoạt auto-switch của
 *             router) bị lột pixel nhưng mô tả text sống sót.
 * - blind:    không đọc được ảnh, không có sidecar - bỏ ảnh, chèn ghi chú để
 *             bot nói thật thay vì im lặng hoặc bịa.
 */

export type ImageContextMode = "native" | "describe" | "hybrid" | "blind";

export async function resolveImageContextMode(override?: ModelOverride): Promise<ImageContextMode> {
  const kind = await classifyModelVision(override);
  const sidecar = isSidecarConfigured();
  switch (kind) {
    case "no-vision":
      return sidecar ? "describe" : "blind";
    case "combo":
      // Không có sidecar thì hybrid không làm được gì hơn native - router
      // auto-switch vẫn tự đẩy thành viên vision lên đầu khi lượt có ảnh
      return sidecar ? "hybrid" : "native";
    default:
      // vision + unknown: lạc quan như hành vi cũ
      return "native";
  }
}

const blindImageNote = (count: number): string =>
  `[Người dùng gửi kèm ${count} ảnh nhưng bạn KHÔNG xem được ảnh trực tiếp - ` +
  "nói thật điều đó và nhờ họ mô tả bằng chữ nếu cần nội dung ảnh để trả lời.]";

const DESCRIBE_FAILED_NOTE =
  "[Có ảnh đính kèm nhưng hệ thống đọc ảnh đang trục trặc, chưa mô tả được - " +
  "nói thật với người dùng nếu cần nội dung ảnh để trả lời.]";

function historyRendering(imageMode: ImageContextMode): HistoryImageRendering | undefined {
  if (imageMode === "describe") return { describe: getImageDescription, keepPixels: false };
  if (imageMode === "hybrid") return { describe: getImageDescription, keepPixels: true };
  return undefined;
}

/**
 * History + batch hiện tại -> messages hoàn chỉnh cho generateText, ảnh đã xử
 * lý đúng chế độ. Trả kèm imageMode để agent-loop ghi log chẩn đoán được.
 *
 * @param forceMode ép chế độ thay vì tự phát hiện - đường reactive fallback:
 * lượt native bị provider từ chối ảnh (4xx) thì agent-loop dựng lại input ở
 * describe/blind rồi thử lại, không đợi cache detect hết hạn.
 */
export async function buildTurnMessages(params: {
  history: StoredMessage[];
  batch: ParsedMessage[];
  override?: ModelOverride;
  forceMode?: ImageContextMode;
}): Promise<{ messages: ModelMessage[]; imageMode: ImageContextMode }> {
  const imageMode = params.forceMode ?? (await resolveImageContextMode(params.override));
  // blind: ngân sách ảnh history = 0, content tự rơi về text "[gửi kèm N ảnh]"
  const imageLimit = imageMode === "blind" ? 0 : env.HISTORY_IMAGE_CONTEXT_LIMIT;

  if (imageMode === "describe" || imageMode === "hybrid") {
    // Mô tả TRƯỚC các ảnh history sắp vào context - gồm cả ảnh passive-listen
    // chưa từng qua lượt agent nào (nhóm gửi vé số rồi mới @mention bot).
    // Build messages phía dưới chỉ đọc cache sync.
    await ensureDescriptionsFor(collectImagesWithinBudget(params.history, imageLimit), loadStoredImage);
  }

  const messages = historyToModelMessages(
    params.history,
    imageLimit,
    loadStoredImage,
    historyRendering(imageMode),
  );
  messages.push({ role: "user", content: await buildCurrentTurnContent(params.batch, imageMode) });
  return { messages, imageMode };
}

/** Gộp toàn bộ ảnh + text trong batch thành content của 1 lượt user */
export async function buildCurrentTurnContent(
  batch: ParsedMessage[],
  imageMode: ImageContextMode,
): Promise<UserContent> {
  const parts: Exclude<UserContent, string> = [];
  let totalImages = 0;

  for (const msg of batch) {
    for (const image of msg.images) {
      totalImages++;
      // blind: không tải, không đính - chỉ chèn 1 ghi chú tổng ở dưới
      if (imageMode === "blind") continue;

      // Ảnh đã persist trước đó (message-turn-processor) thì đọc từ đĩa - không
      // tải lại; persist lỗi thì rơi về tải thẳng từ URL Zalo như cũ
      const stored = image.localPath ? loadStoredImage(image.localPath) : null;
      const downloaded = stored ?? (await downloadImageAsBase64(image.url));
      if (!downloaded) continue;

      // describe/hybrid: sidecar mô tả (cache theo localPath)
      if (imageMode === "describe" || imageMode === "hybrid") {
        const description = await describeImage({ ...downloaded, cacheKey: image.localPath });
        if (description) {
          parts.push({ type: "text", text: `[Mô tả ảnh người dùng vừa gửi: ${description}]` });
        } else if (imageMode === "describe") {
          // describe mà không mô tả được = model chính hoàn toàn mù ảnh này
          parts.push({ type: "text", text: DESCRIBE_FAILED_NOTE });
        }
        // hybrid không cần note lỗi: pixel vẫn được đính ngay bên dưới
      }

      if (imageMode === "native" || imageMode === "hybrid") {
        // Part "file" thay cho "image": kiểu image bị AI SDK v7 đánh dấu
        // deprecated (in cảnh báo mỗi ảnh) và sẽ xóa ở bản sau
        parts.push({ type: "file", data: downloaded.base64, mediaType: downloaded.mediaType });
      }
    }
  }

  if (imageMode === "blind" && totalImages > 0) {
    parts.push({ type: "text", text: blindImageNote(totalImages) });
  }

  const texts = batch.map((m) => m.text.trim()).filter(Boolean);
  const latest = batch[batch.length - 1]!;
  const label = latest.isGroup ? `${latest.senderName}: ` : "";
  const body = texts.length > 0 ? texts.join("\n") : "(người dùng gửi ảnh, không kèm chữ)";
  parts.push({ type: "text", text: `${label}${body}` });

  return parts;
}
