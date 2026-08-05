/**
 * Phân loại lỗi vẽ ảnh: lần hỏng này CÓ ĐÁNG THỬ LẠI không.
 *
 * Chỉ một lớp lỗi đáng thử lại: **provider chạy xong mà không đẻ ra ảnh nào**.
 * Đây là hành vi KHÔNG XÁC ĐỊNH, không phải sai cấu hình - router gửi
 * `tool_choice: "auto"` nên model upstream tự quyết có gọi tool vẽ hay không
 * (`9router/open-sse/handlers/imageProviders/codex.js:176`). Nó chọn trả lời
 * bằng chữ là stream kết thúc sạch sẽ mà chẳng có ảnh.
 *
 * Đo thật 2026-08-05 trên router: lượt hỏng chạy 129,9 giây rồi mới báo lỗi,
 * còn gọi lại ngay sau đó thì 9/9 lần ra ảnh - kể cả prompt infographic tiếng
 * Việt nặng chữ dựng lại gần giống lượt hỏng. Nên thử lại là gần như chắc được.
 *
 * VÌ SAO KHÔNG THỬ LẠI CÁC LỖI KHÁC:
 *   - quá hạn / mất tín hiệu: thử lại là tiêu thêm trọn một trần thời gian nữa,
 *     mà nguyên nhân (provider treo) thường chưa hết.
 *   - HTTP 4xx: sai key, hết quota, sai tham số - lần sau y hệt lần trước.
 *   - chưa cấu hình đủ: thử lại vô nghĩa.
 *
 * HAI ĐƯỜNG NHẬN DIỆN, cố ý xếp theo độ tin cậy giảm dần:
 *   1. `LoiVeHutAnh` - lỗi do CHÍNH MÌNH ném ra, biết chắc lớp lỗi. Bền vững.
 *   2. Chữ của provider - chỉ dùng cho `event: error` vì lúc đó câu lỗi là thứ
 *      duy nhất provider đưa. Router đổi cách hành văn thì nhánh này ngừng khớp
 *      và ta rơi về KHÔNG thử lại: hỏng theo hướng an toàn, không phải hỏng
 *      theo hướng thử lại loạn xạ.
 */

/** Provider kết thúc mà không đưa ra ảnh nào - lớp lỗi duy nhất đáng thử lại */
export class LoiVeHutAnh extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiVeHutAnh";
  }
}

/**
 * Câu router dùng khi stream Codex chạy hết mà không thấy `image_generation_call`
 * nào có `result` (`codex.js:124` và `codex.js:194`). Nó ĐOÁN là tài khoản
 * thiếu quyền Plus/Pro, nhưng đó chỉ là nhánh bắt tất - nên chỉ khớp phần mô tả
 * sự việc ("không trả về ảnh"), bỏ qua phần suy đoán về tài khoản.
 */
const CHU_CUA_PROVIDER = /did not return an image/i;

/** Câu lỗi này của provider có thuộc lớp "chạy xong mà không ra ảnh" không */
export function laChuVeHutAnh(message: string): boolean {
  return CHU_CUA_PROVIDER.test(message);
}

/** Lỗi này có đáng gọi lại provider thêm một lần không */
export function laLoiVeHutAnh(err: unknown): boolean {
  if (err instanceof LoiVeHutAnh) return true;
  return err instanceof Error && laChuVeHutAnh(err.message);
}
