import { getTuning } from "../config/runtime-tuning-settings.js";
import { createHourlyRateLimit } from "../shared/hourly-rate-limit.js";

/**
 * Trần số video MỖI NGƯỜI được tải trong 1 giờ.
 *
 * Đếm theo thread chứ không theo cả bot: một người spam link thì chỉ người đó
 * bị chặn, những cuộc trò chuyện khác vẫn dùng được. Cùng cách đếm với tool tạo
 * file và tool vẽ ảnh (`createHourlyRateLimit`).
 *
 * VÌ SAO CẦN, ngoài chuyện tốn tài nguyên: gửi video ồ ạt từ một nick Zalo CÁ
 * NHÂN là tín hiệu spam rất rõ, và rủi ro lớn nhất của tính năng này không phải
 * VPS quá tải mà là MẤT NICK. Trần ở đây là để giảm rủi ro đó, không phải để
 * tiết kiệm băng thông - băng thông đo ra vốn không phải nút thắt.
 */
const limiter = createHourlyRateLimit({
  limit: () => getTuning("VIDEO_MAX_PER_HOUR"),
  buildReason: ({ used, limit, waitMinutes }) =>
    `Đã tải ${used} video trong 1 giờ qua (trần ${limit}). Thử lại sau khoảng ${waitMinutes} phút.`,
});

export type { RateCheck } from "../shared/hourly-rate-limit.js";
export const checkVideoRateLimit = limiter.check;
/**
 * Trả suất khi KHÔNG gửi được.
 *
 * Trần này đếm số video ĐÃ GỬI, không đếm số lần thử. Nguồn sập mà vẫn trừ suất
 * thì người dùng bị khóa một tiếng vì những lần chưa nhận được gì.
 */
export const hoanSuatVideo = limiter.hoanSuat;
/** Chỉ dùng cho test - xóa toàn bộ trạng thái đếm */
export const resetVideoRateLimit = limiter.reset;
