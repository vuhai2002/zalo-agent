import type { API, ThreadType } from "zca-js";
import { enqueueSend } from "../../middleware/rate-limiter.js";
import { createLogger } from "../../shared/logger.js";
import { laLoiMayChuTuChoi } from "../../zalo/send-reply-in-parts.js";
import { tinKemFile } from "./clean-tool-caption.js";

/**
 * Gửi file/ảnh kèm caption, có đường lui khi Zalo từ chối phần định dạng.
 *
 * Ba tool (`send_file`, 2 tool tài liệu) và `create_image` trước đây mỗi chỗ tự
 * gọi `enqueueSend` với cùng một hình dạng. Gom lại vì lưới an toàn phải nằm ở
 * MỘT chỗ: rải ra bốn nơi thì sớm muộn có nơi bị bỏ quên, mà ở đây "bỏ quên"
 * nghĩa là file đã dựng xong rồi mất trắng vì một dòng caption.
 *
 * Cùng lý do với `sendReplyInParts`: luật kiểm style của Zalo là hộp đen, nên
 * tổ hợp lạ chỉ được phép làm caption NHẠT ĐI, không được kéo cả file đi theo.
 */

const log = createLogger("send-attachment");

export async function guiFileKemCaption(
  api: API,
  threadKey: string,
  threadId: string,
  threadType: ThreadType,
  filePath: string,
  caption: string | undefined,
): Promise<void> {
  const tin = tinKemFile(caption);

  await enqueueSend(threadKey, async () => {
    try {
      return await api.sendMessage({ ...tin, attachments: [filePath] }, threadId, threadType);
    } catch (err) {
      // Không có style để bỏ, hoặc lỗi đường truyền (tin có thể đã tới) thì
      // KHÔNG gửi lại - gửi lại lúc đó là nhân đôi file trước mặt người dùng.
      if (!tin.styles?.length || !laLoiMayChuTuChoi(err)) throw err;

      log.warn(
        { threadId, soStyle: tin.styles.length, err },
        "Zalo từ chối caption có định dạng - gửi lại dạng chữ trơn",
      );
      return await api.sendMessage({ msg: tin.msg, attachments: [filePath] }, threadId, threadType);
    }
  });
}
