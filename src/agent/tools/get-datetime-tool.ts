import { tool } from "ai";
import { z } from "zod";
import { botTimeZone } from "../../config/runtime-tuning-settings.js";
import { getDateTimeParts } from "../../shared/current-datetime.js";

/**
 * Giờ chính xác cho agent - system prompt chỉ có ngày (giữ prompt cache),
 * cần tới phút thì gọi tool này. Không cần tham số: timezone lấy từ
 * BOT_TIMEZONE, người dùng Zalo của bot đều ở cùng múi giờ.
 */
export function createGetDatetimeTool() {
  return tool({
    description:
      "Lấy ngày giờ hiện tại chính xác (ngày, giờ phút, thứ trong tuần, múi giờ). Dùng khi cần giờ hiện tại, tính khoảng cách thời gian, hoặc trả lời câu hỏi về hôm nay/ngày mai. Thứ trong tuần trong kết quả là chính xác tuyệt đối - dùng nguyên văn, không tự suy lại từ ngày.",
    inputSchema: z.object({}),
    execute: async () => {
      const p = getDateTimeParts(botTimeZone());
      return `Bây giờ là ${p.time} ${p.weekday}, ngày ${p.date} (múi giờ ${p.timezone}).`;
    },
  });
}
