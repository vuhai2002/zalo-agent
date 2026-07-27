import { tool } from "ai";
import { z } from "zod";
import { isImageGenConfigured } from "../../config/runtime-image-settings.js";
import { loadStoredImage } from "../../conversation/media-store.js";
import { generateImage } from "../../images/image-generation-client.js";
import { checkImageRateLimit } from "../../images/image-rate-limit.js";
import { enqueueSend } from "../../middleware/rate-limiter.js";
import { createLogger } from "../../shared/logger.js";
import { withNamedTempFile } from "../../shared/temp-file-store.js";
import { collectRecentImagePaths } from "./read-image-tool.js";
import type { ToolContext } from "./index.js";

/**
 * Tool vẽ ảnh mới hoặc SỬA ảnh người dùng vừa gửi, rồi gửi luôn vào hội thoại.
 *
 * Nhắn báo trước khi vẽ: đo thật là ~70 giây mỗi ảnh. Im lặng ngần ấy thời gian
 * thì người nhắn tưởng bot lơ và nhắn lại - vừa khó chịu vừa đẻ thêm một lượt.
 * Câu báo chỉ gửi SAU khi đã qua cửa kiểm trần và cấu hình, để không hứa lèo.
 *
 * Gửi ảnh với ĐÚNG đuôi file provider trả về: zca-js định tuyến theo đuôi, chỉ
 * jpg/jpeg/png/webp mới đi đường photo_original và hiện thành ẢNH trong chat -
 * sai đuôi thì nó thành file đính kèm phải bấm tải mới xem được.
 *
 * `generate` tiêm được để test không chạm mạng và không tốn tiền.
 */

const log = createLogger("create-image");

const DELIVERED_NOTE =
  "Đã vẽ và GỬI ảnh cho người dùng rồi. KHÔNG gọi send_file để gửi lại ảnh này.";

/** Trần ký tự prompt - chặn model đổ cả bài văn vào, provider cũng không nhận nổi */
const MAX_PROMPT_CHARS = 4000;

export function createImageTool(ctx: ToolContext, generate = generateImage) {
  return tool({
    description:
      "Vẽ ảnh mới bằng AI hoặc SỬA ảnh người dùng vừa gửi, rồi gửi thẳng vào cuộc trò chuyện. " +
      "Dùng khi người dùng nhờ vẽ/tạo/thiết kế ảnh, hoặc nhờ sửa ảnh họ gửi (đổi màu, xóa vật thể, đổi phong cách).\n" +
      "Mất khoảng 1 phút mỗi ảnh nên chỉ gọi khi người dùng thật sự muốn có ảnh.\n" +
      "Prompt càng cụ thể càng đẹp: tả chủ thể, bối cảnh, ánh sáng, phong cách, tông màu. " +
      "Muốn ảnh dọc hay ngang thì NÓI TRONG PROMPT (vd 'khung hình dọc'), không có tham số riêng cho kích thước.",
    inputSchema: z.object({
      prompt: z
        .string()
        .min(1)
        .max(MAX_PROMPT_CHARS)
        .describe("Mô tả chi tiết ảnh cần vẽ, hoặc thay đổi cần thực hiện nếu đang sửa ảnh"),
      imageIndex: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "BỎ TRỐNG trong hầu hết trường hợp. CHỈ điền khi người dùng đã GỬI ẢNH trong hội thoại và nhờ sửa chính tấm đó " +
            "(1 = ảnh mới nhất). Yêu cầu vẽ/thiết kế/tạo ảnh mới thì TUYỆT ĐỐI không điền, kể cả khi mô tả rất chi tiết",
        ),
      transparentBackground: z
        .boolean()
        .optional()
        .describe("Cần nền trong suốt (logo, sticker, icon để ghép lên nền khác)"),
      caption: z.string().optional().describe("Lời nhắn gửi kèm ảnh"),
    }),
    execute: async ({ prompt, imageIndex, transparentBackground, caption }) => {
      const threadKey = `${ctx.account.id}:${ctx.message.threadId}`;

      if (!isImageGenConfigured()) {
        return "Tool vẽ ảnh chưa cấu hình (thiếu base URL, model hoặc API key). Nói thật với người dùng là chưa vẽ được.";
      }

      // Nạp ảnh gốc TRƯỚC khi tính vào trần: xin sửa ảnh không tồn tại thì
      // không có gì được vẽ, không có lý do gì trừ suất của người dùng
      let refImage: { base64: string; mediaType: string } | undefined;
      if (imageIndex !== undefined) {
        const paths = collectRecentImagePaths(ctx);

        // Hội thoại CHƯA TỪNG có ảnh -> "sửa ảnh" là ý định bất khả thi (không
        // ai bảo sửa ảnh khi chưa gửi ảnh bao giờ), chắc chắn model điền thừa
        // tham số. Vẽ mới là việc duy nhất hợp lý. Từ chối thì model không nhận
        // ra phải BỎ một tham số - nó loay hoay viết lại prompt rồi bỏ cuộc,
        // đã dính thật: 5 lần gọi, 68k token, người dùng không nhận được gì.
        //
        // Khác hẳn 2 nhánh dưới: ở đó hội thoại CÓ ảnh nên người dùng thật sự
        // đang nhắc tới một tấm ảnh - vẽ mới là làm sai ý họ, phải nói thật.
        if (paths.length > 0) {
          const relPath = paths[imageIndex - 1];
          if (!relPath) {
            return `Hội thoại chỉ còn ${paths.length} ảnh gần đây - imageIndex ${imageIndex} vượt quá. Dùng imageIndex từ 1 đến ${paths.length}, hoặc bỏ hẳn imageIndex để vẽ ảnh mới.`;
          }
          const loaded = loadStoredImage(relPath);
          if (!loaded) {
            return "Ảnh này đã bị dọn khỏi bộ nhớ (quá hạn lưu trữ) nên không đọc được để sửa. Nhờ người dùng gửi lại ảnh.";
          }
          refImage = loaded;
        }
      }

      const rate = checkImageRateLimit(threadKey);
      if (!rate.ok) return rate.reason;

      // Chỉ báo sau khi chắc chắn sẽ vẽ thật
      await enqueueSend(threadKey, () =>
        ctx.api.sendMessage(
          {
            msg: refImage
              ? "Đang sửa ảnh, đợi khoảng 1 phút nhé..."
              : "Đang vẽ ảnh, đợi khoảng 1 phút nhé...",
          },
          ctx.message.threadId,
          ctx.message.threadType,
        ),
      ).catch(() => {
        // Báo trước hỏng không được làm chết cả lượt vẽ
      });

      try {
        const image = await generate({ prompt, refImage, transparentBackground });
        const fileName = `anh-${Date.now()}.${image.ext}`;
        await withNamedTempFile(fileName, image.data, (filePath) =>
          enqueueSend(threadKey, () =>
            ctx.api.sendMessage(
              { msg: caption ?? "", attachments: [filePath] },
              ctx.message.threadId,
              ctx.message.threadType,
            ),
          ),
        );
        log.info(
          { accountId: ctx.account.id, threadId: ctx.message.threadId, kb: Math.round(image.data.length / 1024), sua: Boolean(refImage) },
          "Đã gửi ảnh tự vẽ",
        );
        return `${DELIVERED_NOTE} (${Math.round(image.data.length / 1024)} KB)`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn({ err }, "Vẽ ảnh thất bại");
        return `Vẽ ảnh thất bại (${reason}). Nói thật với người dùng, đừng hứa gửi ảnh sau.`;
      }
    },
  });
}
