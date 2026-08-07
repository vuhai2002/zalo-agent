/**
 * Mốc giờ NGƯỜI TA GỬI một tin Zalo, đọc từ `data.ts` của zca-js.
 *
 * Vì sao không dùng giờ ghi vào DB: tin được ghi vào history ở CUỐI lượt
 * (`message-turn-processor.ts`), nên một lượt chạy 249 giây làm `created_at`
 * lệch 4 phút so với lúc người ta thật sự bấm gửi. Chính con số đó là thứ model
 * đọc để hiểu "hôm nay", "vừa nãy", "sáng nay". Cả Hermes
 * (`gateway/message_timestamps.py` - lấy `event.timestamp` của nền tảng) lẫn
 * goclaw (`channels/telegram/handlers.go` - `time.Unix(message.Date)`) đều lấy
 * giờ từ NỀN TẢNG chứ không phải giờ xử lý.
 *
 * Module THUẦN: không log, không đọc env, không chạm DB.
 */

/**
 * Đơn vị của `data.ts` KHÔNG được ghi ở đâu, và các repo tham khảo hiểu khác
 * nhau: `zalo-personal/src/monitor.ts` coi là GIÂY, còn
 * `zalo-agent-cli/src/commands/group.js` và `deplao-builder` coi là MILLI. Nên
 * phân biệt bằng ĐỘ LỚN thay vì chọn một cách hiểu rồi cầu may:
 *
 *   - >= 1e11: chắc chắn milli (1e11 milli = 1973; 1e11 giây = năm 5138)
 *   - >= 1e9:  giây (1e9 giây = 2001)
 *
 * Dưới 1e9 là rác - không có tin Zalo nào gửi trước năm 2001.
 */
const NGUONG_MILI = 1e11;
const NGUONG_GIAY = 1e9;

/**
 * Khoảng chấp nhận quanh giờ nhận. Ngoài khoảng này thì bỏ `data.ts`, dùng giờ
 * nhận.
 *
 * Rộng về phía QUÁ KHỨ có chủ đích: listener nối lại sau khi mất mạng sẽ nhận
 * một loạt tin cũ, và giữ đúng giờ gửi thật của chúng chính là giá trị của cả
 * module này - kẹp chặt sẽ dán nhãn "vừa gửi" lên tin của hai tiếng trước.
 *
 * Chặt về phía TƯƠNG LAI vì không tin nào gửi được từ tương lai; 5 phút chỉ để
 * dung thứ lệch đồng hồ giữa máy chủ Zalo và máy chạy bot.
 *
 * Mục đích của cái kẹp này là chặn giá trị RÁC làm model tin sai ngày rồi đặt
 * lịch sai, không phải chặn kẻ tấn công: `ts` do máy chủ Zalo sinh, người gửi
 * không đặt được nó bằng nội dung tin.
 */
const TRE_TOI_DA_MS = 7 * 24 * 60 * 60 * 1000;
const SOM_TOI_DA_MS = 5 * 60 * 1000;

/** Đổi `data.ts` thành milli epoch. `null` khi không đọc được. */
function doiSangMilli(raw: unknown): number | null {
  const so = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(so) || so <= 0) return null;
  if (so >= NGUONG_MILI) return Math.floor(so);
  if (so >= NGUONG_GIAY) return Math.floor(so * 1000);
  return null;
}

/**
 * Mốc giờ gửi dạng ISO UTC, cùng định dạng với cột `created_at` của bảng
 * `messages` để hai bên so sánh được trực tiếp.
 *
 * @param raw `data.ts` từ payload zca-js (chuỗi hoặc số)
 * @param nhanLuc giờ nhận tin - vừa là mốc để kẹp, vừa là giá trị thay thế khi
 * `raw` hỏng. Truyền vào được để test không phụ thuộc đồng hồ thật.
 */
export function mocGuiCuaTinZalo(raw: unknown, nhanLuc: Date = new Date()): string {
  const milli = doiSangMilli(raw);
  if (milli === null) return nhanLuc.toISOString();

  const lech = milli - nhanLuc.getTime();
  if (lech > SOM_TOI_DA_MS || lech < -TRE_TOI_DA_MS) return nhanLuc.toISOString();

  return new Date(milli).toISOString();
}
