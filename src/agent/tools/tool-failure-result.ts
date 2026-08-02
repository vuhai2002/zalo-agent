/**
 * Quy ước đánh dấu "lượt gọi tool này THẤT BẠI" theo cách máy đọc được.
 *
 * Vì sao cần: repo đã chốt từ sớm là **tool không ném lỗi ra agent loop** - mọi
 * nhánh hỏng đều bắt lại rồi trả một câu tiếng Việt cho model tự diễn giải. Đó
 * là quyết định đúng (model xử lý được "trang này chặn bot" tốt hơn là cả lượt
 * chết), nhưng nó có một hệ quả không ai để ý: AI SDK chỉ sinh phần
 * `tool-error` khi `execute` NÉM. Tool trả chuỗi luôn ra `tool-result`, kể cả
 * khi chuỗi đó nói là hỏng.
 *
 * Nên bộ đếm lỗi của `tool-loop-guard` gần như là code chết. Đo thật: model gọi
 * `web_fetch` hỏng trên 8 URL khác nhau, hay `web_search` rỗng trên 8 từ khóa
 * khác nhau, guard đều KHÔNG chặn - đúng cái ca đắt nhất thì nó câm.
 *
 * Cách chữa ở đây là dạy tầng tool nói rõ mình hỏng, thay vì bắt guard đoán qua
 * câu chữ tiếng Việt (Hermes dò chuỗi trong `classify_tool_failure`; làm vậy thì
 * đổi một chữ trong thông báo là guard mù trở lại, mà không có test nào đỏ).
 *
 * Vì sao là OBJECT chứ không phải tiền tố chuỗi kiểu `"[LỖI] ..."`:
 * nội dung web/tin nhắn do người lạ soạn đi thẳng vào chuỗi kết quả, nên bất kỳ
 * luật nào dựa trên chữ trong chuỗi đều có thể bị soạn cho trùng. Hình dạng
 * object thì nội dung không tự giả được - nó luôn nằm trong TRƯỜNG, không bao
 * giờ là cái vỏ.
 *
 * Model đọc `{"ok":false,"loi":"..."}` không khác gì đọc câu trần thuật, mà lại
 * biết chắc đây là nhánh hỏng.
 *
 * Module THUẦN: không log, không đọc env, không chạm DB.
 */

export type KetQuaLoiTool = {
  /** Luôn `false`. Chính trường này là dấu hiệu, không phải câu chữ trong `loi`. */
  readonly ok: false;
  /** Câu cho model đọc - vẫn là tiếng Việt tự nhiên như trước */
  readonly loi: string;
};

/**
 * Bọc một câu báo hỏng thành kết quả tool có đánh dấu.
 *
 * Dùng ở MỌI nhánh hỏng của mọi tool. Nhánh thành công vẫn trả chuỗi trần như
 * cũ - không có gì phải đánh dấu, và giữ nguyên thì lượt chạy tốt không đổi
 * chút nào so với trước.
 *
 * KẾT QUẢ RỖNG là hỏng hay thành công? Luật: rỗng mà CHẮC CHẮN thì là thành
 * công, rỗng mà KHÔNG PHÂN BIỆT ĐƯỢC với hỏng thì là hỏng.
 *
 *   - `schedule_task list` không có lịch nào -> chuỗi trần. Store trả lời dứt
 *     khoát: thread này không có job. Gọi lại cũng vẫn vậy, và đó là câu trả lời
 *     đúng cho người dùng.
 *   - `web_search` không có kết quả -> `ketQuaLoi`. Chuỗi provider nuốt lỗi rồi
 *     trả mảng rỗng, nên "rỗng" ở đây vừa có thể là không có gì thật, vừa có thể
 *     là mọi dịch vụ tìm kiếm đang chết. Không phân biệt được thì phải tính là
 *     hỏng - gọi lại 8 từ khóa vẫn rỗng là vòng lặp cần chặn.
 */
export function ketQuaLoi(thongDiep: string): KetQuaLoiTool {
  return { ok: false, loi: thongDiep };
}

/**
 * Kết quả này có phải nhánh hỏng không.
 *
 * Chỉ nhìn HÌNH DẠNG. Không dò chữ, không đoán theo tên tool.
 *
 * Kiểm CẢ `loi` chứ không chỉ `ok`: repo có sẵn 4 type khác cùng hình dạng
 * `{ok:false, ...}` nhưng khác tên trường - `LimitCheck` và `RateCheck` dùng
 * `reason`, `parseSchedule` dùng `error`. Chỉ kiểm `ok` thì một chỗ lỡ tay
 * `return limit` (thay vì `ketQuaLoi(limit.reason)`) vẫn lọt: guard đếm đúng
 * nên không test guard nào đỏ, mà model thì nhận một object có câu hướng dẫn
 * nằm ở khóa nó không được dặn đọc.
 */
export function laKetQuaLoi(ketQua: unknown): ketQua is KetQuaLoiTool {
  if (!ketQua || typeof ketQua !== "object" || Array.isArray(ketQua)) return false;
  const o = ketQua as { ok?: unknown; loi?: unknown };
  return o.ok === false && typeof o.loi === "string";
}
