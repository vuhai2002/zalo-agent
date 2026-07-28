import { createHourlyRateLimit } from "../shared/hourly-rate-limit.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

/**
 * Trần số file mỗi thread được tạo trong 1 giờ. Bot đọc tin người lạ, mà dựng
 * file là việc tốn CPU nhất trong một lượt agent - không có trần thì một người
 * spam "xuất file" là ghim luôn tiến trình.
 *
 * Phần đếm + dọn bộ nhớ nằm ở shared/hourly-rate-limit (dùng chung với tool vẽ
 * ảnh); ở đây chỉ còn trần và câu báo riêng của tool tạo file.
 */

const limiter = createHourlyRateLimit({
  limit: () => getTuning("DOCUMENT_MAX_PER_HOUR"),
  buildReason: ({ used, limit, waitMinutes }) =>
    `Đã tạo ${used} file trong 1 giờ qua (trần ${limit}). Thử lại sau khoảng ${waitMinutes} phút, hoặc trả lời trực tiếp trong chat thay vì gửi file.`,
});

export type { RateCheck } from "../shared/hourly-rate-limit.js";

export const checkDocumentRateLimit = limiter.check;

/** Chỉ dùng cho test - xóa toàn bộ trạng thái đếm */
export const resetDocumentRateLimit = limiter.reset;
