import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { createLogger } from "../shared/logger.js";
import type { KenhLuot } from "./kenh-luot.js";
import { sendSeenReceipt } from "./message-receipts.js";
import { toZaloReaction } from "./reaction-icons.js";
import { duongGuiZcaJs } from "./send-reply-in-parts.js";
import { startTypingIndicator } from "./typing-indicator.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

const log = createLogger("kenh-ca-nhan");

/**
 * Báo cho người nhắn biết bot đã nhận: thả reaction vào tin vừa gửi.
 * Không await ở luồng chính và tự nuốt lỗi - reaction hỏng không được làm
 * chậm hay chết đường trả lời.
 */
function tuThaCamXuc(config: AccountConfig, api: API, msg: ParsedMessage): void {
  if (!config.autoReactEnabled || !msg.msgId) return;
  void api
    .addReaction(toZaloReaction(config.autoReactIcon), {
      data: { msgId: msg.msgId, cliMsgId: msg.cliMsgId },
      threadId: msg.threadId,
      type: msg.threadType,
    })
    .catch((err) => log.debug({ err }, "Auto-react thất bại"));
}

/**
 * Kênh TÀI KHOẢN CÁ NHÂN (zca-js) - đủ cả 5 năng lực.
 *
 * Gom vào một nhà máy để chỗ gọi không phải tự nhớ năng lực nào có: thêm một
 * kênh mới chỉ cần viết một nhà máy nữa, `processBatch` không đổi.
 *
 * PHẢI GIỮ THUẦN (không state, không bộ nhớ đệm giữa các lời gọi). Hàm này
 * được gọi ở HAI chỗ cho cùng một account: một lần lúc `attachAccount` (bản
 * lưu vào sổ `running`, cho scheduler lấy lại qua `getRunningAccountKenh`) và
 * một lần MỖI BATCH ở `incoming-message-router`. Router không chuyển sang dùng
 * bản đã lưu vì nó còn cần `api` cho việc riêng của zca-js
 * (`sendDeliveredReceipt`, `getGroupInfo`) - đó là đợt refactor khác. Chừng
 * nào nhà máy này còn thuần thì hai thực thể không thể lệch nhau; nhét state
 * vào đây là biến chúng thành hai nguồn sự thật.
 */
export function kenhCaNhan(api: API): KenhLuot {
  return {
    api,
    duongGui: (threadId, threadType) => duongGuiZcaJs(api, threadId, threadType),
    baoDaXem: (batch) => sendSeenReceipt(api, batch),
    tuThaCamXuc: (config, msg) => tuThaCamXuc(config, api, msg),
    batDangNhap: (threadId, threadType) =>
      startTypingIndicator({
        send: (t, ty) => api.sendTypingEvent(t, ty),
        threadId,
        threadType,
      }),
  };
}
