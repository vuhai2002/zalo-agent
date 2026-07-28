import { createHourlyRateLimit } from "../shared/hourly-rate-limit.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

/**
 * Trần số ảnh mỗi thread được vẽ trong 1 giờ.
 *
 * Chặt hơn tool tạo file vì khác hẳn về giá: dựng .docx chỉ tốn CPU của chính
 * mình, còn mỗi lần vẽ ảnh là một lần TRẢ TIỀN cho provider và chiếm ~70 giây.
 * Bot đọc tin người lạ nên đây là hàng phòng thủ chính chống đốt quota.
 */

const limiter = createHourlyRateLimit({
  limit: () => getTuning("IMAGE_GEN_MAX_PER_HOUR"),
  buildReason: ({ used, limit, waitMinutes }) =>
    `Đã vẽ ${used} ảnh trong 1 giờ qua (trần ${limit}). Thử lại sau khoảng ${waitMinutes} phút. ` +
    `Trong lúc chờ vẫn có thể mô tả bằng lời cho người dùng hình dung.`,
});

export const checkImageRateLimit = limiter.check;

/** Chỉ dùng cho test - xóa toàn bộ trạng thái đếm */
export const resetImageRateLimit = limiter.reset;
