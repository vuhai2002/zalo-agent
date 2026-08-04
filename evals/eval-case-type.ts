/**
 * Hình dạng một case eval.
 *
 * Khác `pnpm test` ở chỗ căn bản: test chạy model GIẢ nên đo được chuyện tất
 * định (dây nối, nhánh lỗi, thứ tự). Bộ này chạy model THẬT nên đo được thứ
 * test không đo nổi: model có tra cứu thay vì đoán không, có hỏi lại khi thiếu
 * thông tin không, có tệ đi sau khi mình sửa persona không.
 *
 * Module THUẦN: chỉ khai kiểu, không import gì.
 */

export type MongDoi = {
  /** PHẢI gọi (thứ tự bất kỳ, gọi thêm tool khác vẫn đạt) */
  goiTool?: string[];
  /** TUYỆT ĐỐI không được gọi */
  khongGoiTool?: string[];
  /**
   * CHỈ dùng cho tính chất CẤU TRÚC: kết thúc bằng dấu hỏi, không chứa `**`,
   * độ dài dưới N.
   *
   * CẤM khẳng định trên nội dung ngữ nghĩa ("phải chứa từ X"). Model dao động
   * giữa các lần chạy, nên câu chữ là nguồn đỏ ngẫu nhiên - và một bộ eval đỏ
   * ngẫu nhiên thì người ta sẽ ngừng đọc nó, tức là mất luôn cả những lần đỏ
   * thật.
   */
  kiemTraText?: { moTa: string; dat: (text: string) => boolean };
  /**
   * Khẳng định trên THAM SỐ model truyền cho tool, không chỉ tên tool.
   *
   * Cần cho những case mà gọi đúng tool vẫn có thể sai hoàn toàn: `save_memory`
   * với `action: "them"` khi người dùng vừa đính chính là ĐẺ THÊM một điều mâu
   * thuẫn, trong khi phép đo chỉ nhìn tên tool lại báo xanh.
   *
   * `input` là chuỗi JSON đúng như trace ghi lại.
   */
  kiemTraToolArgs?: { tool: string; moTa: string; dat: (input: string) => boolean };
};

export type EvalCase = {
  ten: string;
  /**
   * VÌ SAO case này tồn tại. Bắt buộc, không phải cho đẹp: case không nêu được
   * lý do là case người sau sẽ xóa nhầm khi nó đỏ, hoặc tệ hơn - sửa mong đợi
   * cho nó xanh mà không biết mình vừa bỏ mất một hàng rào.
   */
  lyDo: string;
  /** Người dùng nhắn gì */
  tinNhan: string;
  /** Persona riêng cho case này; bỏ trống thì dùng persona rỗng (chỉ có BASE_PERSONA) */
  persona?: string;
  /** Tool TẮT cho agent của case này - dùng thử nhánh "agent hẹp tool" */
  disabledTools?: string[];
  /** Chat nhóm thay vì chat riêng */
  laNhom?: boolean;
  /**
   * Điều bot ĐÃ NHỚ về người nhắn, gieo sẵn trước khi chạy lượt.
   *
   * Không có nó thì không đo được nhánh sửa/xóa của `save_memory`: model phải
   * đang nhớ một điều SAI thì lời đính chính mới có nghĩa.
   */
  factCoSan?: string[];
  mongDoi: MongDoi;
};
