import { getDateTimeParts } from "../shared/current-datetime.js";

/**
 * MỘT dòng tin người dùng như model đọc thấy: `[08/08 00:12] Hải: nội dung`.
 *
 * Vì sao gom về một hàm dùng chung: có HAI đường dựng tin người dùng - lịch sử
 * (`history-to-model-messages.ts`) và tin của lượt đang chạy
 * (`agent-turn-content.ts`, dùng chung cho cả tin chen giữa lượt). Hai đường
 * trôi khỏi nhau đã gây một lỗi thật:
 *
 *   Lịch sử có nhãn giờ, tin của lượt hiện tại thì KHÔNG. Nên mốc giờ mới nhất
 *   model nhìn thấy luôn là của tin TRƯỚC ĐÓ. Ngày 07/08/2026, tin lúc 23:37
 *   chết vì lỗi provider rồi vào lịch sử; 00:12 hôm sau người dùng nhắn lại,
 *   model đọc nhãn 23:37 ở cuối lịch sử và tin rằng câu hỏi được gửi lúc đó -
 *   phải gọi thêm `get_datetime` mới gỡ được là "hôm nay" nghĩa là ngày nào.
 *
 * Hermes gặp đúng bài này và giải đúng cách: một hàm render duy nhất, và MỘT
 * công tắc chi phối cả tin hiện tại lẫn lịch sử replay (`gateway/run.py` truyền
 * cùng `inject_timestamps` cho hai đường). goclaw chống nhầm bằng nhãn cấu trúc
 * `[Your current message]` - cách khác, cùng một nhận thức: ranh giới đó phải
 * được nói ra bằng cách nào đó.
 *
 * Module THUẦN: timezone do caller truyền vào (cùng luật với
 * `current-datetime.ts`) nên không kéo theo `runtime-tuning-settings.ts` - mà
 * module đó mở DB ngay lúc import.
 */

/**
 * `[25/07 14:30]` theo `BOT_TIMEZONE`, KHÔNG phải giờ của tiến trình.
 *
 * Bản cũ dùng `d.getHours()`/`d.getDate()` - giờ local của máy chạy bot. Trên
 * máy dev Windows (múi Việt Nam) nó trùng với `BOT_TIMEZONE` nên đúng do trùng
 * hợp; trong container Docker (`node:24-alpine` chạy UTC, không có `TZ=` ở đâu
 * trong Dockerfile lẫn compose) thì nhãn lịch sử lệch 7 tiếng so với dòng "Hôm
 * nay là..." của system prompt - dòng đó vốn đã đi qua `BOT_TIMEZONE`. Model
 * nhận một prompt tự mâu thuẫn và không có cách nào biết bên nào đúng.
 *
 * Đây từng là nơi DUY NHẤT trong `src/` dựng mốc thời gian cho model đọc mà
 * không qua `BOT_TIMEZONE`, tức chỗ duy nhất qua mặt được ô "Múi giờ của bot"
 * trên dashboard.
 */
export function formatTimestamp(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  const p = getDateTimeParts(timeZone, d);
  // `p.date` là "25/07/2026" - bỏ năm cho gọn, giữ nguyên hình dạng cũ. Cắt
  // bằng split chứ không slice(0,5) để đổi định dạng ở nguồn không âm thầm ra
  // chuỗi cụt.
  const [ngay, thang] = p.date.split("/");
  return `[${ngay}/${thang} ${p.time}]`;
}

export type ThamSoDongTin = {
  /** ISO UTC. Thiếu thì bỏ hẳn nhãn giờ - tin cũ lưu trước khi có cột này */
  createdAt?: string;
  timeZone: string;
  /** Bỏ trống thì không dán tên - dùng cho tin không rõ người gửi */
  senderName?: string;
  /** Người gửi ngoài allowlist: dán nhãn để model đọc mà không làm theo */
  nhanChuaXacMinh?: string;
  noiDung: string;
};

/**
 * Ghép đúng một dòng. Thứ tự cố định `[giờ] [nhãn] Tên: nội dung` - đây là hình
 * dạng mà persona đang mô tả cho model ("định dạng [ngày/tháng giờ:phút] Tên:
 * nội dung"), đổi ở đây thì phải đổi cả câu đó trong `persona-prompt.ts`.
 */
export function dongTinNguoiDung(p: ThamSoDongTin): string {
  const ts = p.createdAt ? formatTimestamp(p.createdAt, p.timeZone) : "";
  const nhan = p.nhanChuaXacMinh ? `${p.nhanChuaXacMinh} ` : "";
  const ten = p.senderName ? `${p.senderName}: ` : "";
  return `${ts} ${nhan}${ten}${p.noiDung}`.trim();
}
