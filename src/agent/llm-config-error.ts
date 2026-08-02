/**
 * Lỗi CẤU HÌNH LLM còn thiếu - khác hẳn lỗi provider trả về.
 *
 * Vì sao cần một lớp riêng thay vì `Error` thường: từ khi `.env` chỉ còn một
 * biến bắt buộc, bot KHỞI ĐỘNG ĐƯỢC khi chưa cấu hình model/key/base URL (cố
 * ý - phải vào được dashboard mới nhập được). Nghĩa là trạng thái "chưa cấu
 * hình" giờ là trạng thái BÌNH THƯỜNG của lần cài đầu, và mỗi tin nhắn tới đều
 * đi trọn đường tới `resolveLanguageModel` rồi ném.
 *
 * `phanLoaiLoiProvider` chỉ đọc mã HTTP và dấu hiệu mạng, nên `Error` thường
 * rơi vào `unknown` -> người nhắn nhận câu "bạn nhắn lại giúp mình sau ít phút
 * nhé". Đó là NÓI DỐI: chờ bao lâu cũng không tự hết, y hệt cái bệnh mà nhánh
 * `auth` sinh ra để chữa.
 *
 * Nhận diện bằng `instanceof`, KHÔNG dò chữ trong thông báo - cùng lý do với
 * `ketQuaLoi`: luật dựa trên câu chữ thì đổi một chữ là bộ canh mù, mà không có
 * test nào đỏ.
 *
 * Module THUẦN: 0 import.
 */
export class LoiCauHinhLlm extends Error {
  readonly loaiCauHinh: "api_key" | "model" | "base_url";

  constructor(loaiCauHinh: "api_key" | "model" | "base_url", message: string) {
    super(message);
    this.name = "LoiCauHinhLlm";
    this.loaiCauHinh = loaiCauHinh;
  }

  /**
   * Kiểm theo HÌNH DẠNG chứ không `instanceof` trần.
   *
   * `instanceof` vỡ khi có hai bản sao module trong bộ nhớ - chuyện xảy ra thật
   * với pnpm layout và với `await import()` động trong test. Cùng bài với
   * `APICallError.isInstance` của AI SDK.
   */
  static isInstance(err: unknown): err is LoiCauHinhLlm {
    return Boolean(err) && (err as { name?: unknown }).name === "LoiCauHinhLlm";
  }
}
