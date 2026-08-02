import { tool } from "ai";
import { z } from "zod";
import { getRecentMessages } from "../../conversation/history-store.js";
import { loadStoredImage } from "../../conversation/media-store.js";
import { askAboutImage } from "../vision-sidecar.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";

/**
 * Tool "nhìn kỹ lại" ảnh - mảnh cuối của hệ vision (pattern read_image của
 * GoClaw / vision_analyze của Hermes): mô tả cache sinh TRƯỚC khi biết câu
 * hỏi nên lossy - "đếm số cá màu vàng" cần hỏi lại con mắt với prompt đúng
 * câu hỏi. Agent tự quyết khi nào mô tả sẵn có không đủ.
 *
 * Chỉ vào schema khi sidecar đã cấu hình (tool-registry `available`).
 */

/**
 * Trần số ảnh gần đây agent chọn được qua imageIndex. Chính sách tự đặt: đủ
 * rộng cho "ảnh thứ 3 tính từ dưới lên", đủ hẹp để model không phải đếm mò
 * trong danh sách dài. Không đọc file nào cho tới khi model chọn nên trần này
 * không tốn gì.
 */
const RECENT_IMAGE_LIMIT = 10;

/**
 * Gom đường dẫn ảnh MỚI NHẤT TRƯỚC: batch của lượt hiện tại (chưa vào DB)
 * rồi tới history. Xuất riêng để test không cần dựng tool.
 */
export function collectRecentImagePaths(ctx: ToolContext): string[] {
  const paths: string[] = [];
  for (let i = ctx.batch.length - 1; i >= 0; i--) {
    for (const image of ctx.batch[i]!.images) {
      if (image.localPath) paths.push(image.localPath);
    }
  }
  const history = getRecentMessages(ctx.account.id, ctx.message.threadId);
  for (let i = history.length - 1; i >= 0; i--) {
    paths.push(...(history[i]!.images ?? []));
  }
  return paths.slice(0, RECENT_IMAGE_LIMIT);
}

/** `ask` tiêm được để test không chạm mạng thật */
export function createReadImageTool(ctx: ToolContext, ask = askAboutImage) {
  return tool({
    description:
      "Nhìn kỹ lại ảnh đã nhận trong hội thoại bằng model đọc ảnh, với một câu hỏi cụ thể " +
      "(đếm số lượng, đọc chữ nhỏ, xác định chi tiết, so sánh màu sắc). " +
      "Dùng khi mô tả ảnh sẵn có trong hội thoại không đủ chi tiết để trả lời người dùng.",
    inputSchema: z.object({
      question: z
        .string()
        .min(1)
        .describe('Câu hỏi cụ thể về ảnh, vd "Đếm chính xác số cá màu vàng trong ảnh"'),
      imageIndex: z.coerce
        .number()
        .int()
        .min(1)
        .max(RECENT_IMAGE_LIMIT)
        .default(1)
        .describe("Ảnh thứ mấy tính từ MỚI NHẤT (1 = ảnh mới nhất trong hội thoại)"),
    }),
    execute: async ({ question, imageIndex }) => {
      const paths = collectRecentImagePaths(ctx);
      if (paths.length === 0) {
        return ketQuaLoi("Không có ảnh nào trong hội thoại gần đây để xem.");
      }
      const relPath = paths[imageIndex - 1];
      if (!relPath) {
        return ketQuaLoi(
          `Hội thoại chỉ còn ${paths.length} ảnh gần đây - imageIndex ${imageIndex} vượt quá.`,
        );
      }
      const image = loadStoredImage(relPath);
      if (!image) {
        return ketQuaLoi("Ảnh này đã bị dọn khỏi bộ nhớ (quá hạn lưu trữ), không xem lại được nữa.");
      }
      try {
        const answer = await ask(image, question);
        return answer || ketQuaLoi("Model đọc ảnh không trả lời được câu hỏi này.");
      } catch (err) {
        // Trả thông báo cho model diễn giải, không throw ra agent loop -
        // cùng luật với web_search (provider lỗi không được giết cả lượt)
        const reason = err instanceof Error ? err.message : String(err);
        return ketQuaLoi(
          `Hệ thống đọc ảnh đang lỗi (${reason}). Nói thật với người dùng là chưa xem kỹ được ảnh, đừng đoán nội dung.`,
        );
      }
    },
  });
}
