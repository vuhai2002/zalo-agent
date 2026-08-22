/**
 * Ký tự trên một token cho tiếng Việt.
 *
 * ĐÃ ĐO bằng `gpt-tokenizer` (bảng BPE gốc của OpenAI) trên 4 mẫu tiếng Việt
 * thật - hội thoại, tin tức, kỹ thuật, khối `<noi_dung_ngoai>`:
 *
 *   họ o200k (GPT-4o/5):  3,1 - 3,8 ký tự/token
 *   họ cl100k (GPT-4):    2,1 - 2,2 ký tự/token
 *   tiếng Anh đối chứng:  4,5
 *
 * Lấy 2.5 nên ước CAO hơn thực tế (khoảng 24-52% nếu tính trên số thật) với họ
 * o200k, nhưng vẫn HỤT 12-17% với họ cl100k. Tokenizer của Anthropic không công
 * khai nên không đo được cho chính model mặc định của repo. Biên `HE_SO_AN_TOAN`
 * (chừa 30%) nuốt được mức hụt đó, nhưng đây là chỗ phải theo dõi qua log
 * `uocLuong.lechPhanTram` chứ không phải hằng số đã yên.
 *
 * VÌ SAO NẰM RIÊNG MỘT FILE, KHÔNG Ở `token-estimate.ts`: ba phía cần nó và
 * hai trong ba không được phép kéo theo `token-estimate.ts`.
 *
 *   - `token-estimate.ts` (agent) - nơi dùng chính, cắt ngữ cảnh thật.
 *   - `runtime-tuning-settings.ts` (config) - luật chéo chặn cấu hình tự mâu
 *     thuẫn. File này nằm dưới `config/`, kéo module của `agent/` vào là mở
 *     đường cho vòng import.
 *   - Trang Cấu hình (trình duyệt) - hiện quy đổi "≈ N token" dưới ô nhập ký
 *     tự. `token-estimate.ts` import kiểu từ gói `ai`, không nên để trình duyệt
 *     chạm vào.
 *
 * File này KHÔNG import gì cả, nên cả ba nạp được.
 *
 * BÀI HỌC ĐÃ TRẢ GIÁ: trước khi tách, luật chéo `DOCUMENT_MAX_CHARS` tự viết
 * riêng hằng số 4 ký tự/token - con số của TIẾNG ANH, trong một bot tiếng Việt.
 * Hệ quả đo được: luật cho phép trần tài liệu tới 45.875 ký tự trong khi bộ
 * ước lượng thật chỉ chịu được 28.672 - chênh 60%, và người đặt 40.000 được lưu
 * bình thường rồi bot bị cắt giữa lúc viết file, đúng cái mà luật đó sinh ra để
 * chặn. Hằng số quy đổi chỉ được có MỘT bản.
 */
export const KY_TU_MOI_TOKEN = 2.5;

/** Ước lượng số token của một đoạn dài `soKyTu` ký tự. Làm tròn lên. */
export function uocTokenTuKyTu(soKyTu: number): number {
  return Math.ceil(soKyTu / KY_TU_MOI_TOKEN);
}
