import type { ParsedSchedule } from "../../scheduler/schedule-parser.js";
import { scheduleColumns } from "../../scheduler/scheduled-job-record.js";
import type { JobKind, ScheduledJob } from "../../scheduler/scheduled-job-store.js";

/**
 * Tìm lịch hẹn đã có trùng với lịch model sắp tạo.
 *
 * VÌ SAO CÓ FILE NÀY - ca thật ngày 2026-08-20, đọc từ trace:
 *
 * Người dùng nhờ đặt một lời nhắc, bot đặt xong ở lượt 2 rồi nói "Đã đặt lịch
 * xong rồi". Lượt 3 người dùng chỉ nhắn "okay cảm ơn bạn" - và bot TẠO LẠI
 * đúng lời nhắc đó lần nữa. Model tự khai ý định trong trace: "Mình KIỂM TRA
 * và chốt lịch nhắc ngay để bảo đảm tin sẽ được gửi đúng giờ nhé."
 *
 * Nó muốn kiểm tra thật. Nhưng lịch sử hội thoại KHÔNG mang tool call
 * (`historyToModelMessages` chỉ trả `{role:"assistant", content}` - thuần
 * chữ), nên sang lượt sau model không có bằng chứng nào là tool đã chạy; nó
 * chỉ thấy đúng câu nó tự nói. Thứ duy nhất trong tầm với để "kiểm tra" là
 * `create`. Kết quả: hai job y hệt, người dùng nhận hai tin lúc 11:00 và tốn
 * hai suất trần tin chủ động.
 *
 * KHÓA SO TRÙNG = `(kind, lịch, TÊN)`, KHÔNG có `payload`. Đây là số đo từ
 * chính hai job đó, không phải suy đoán:
 *
 *   name     "Nhắc đóng học phí Phật học"  ==  "Nhắc đóng học phí Phật học"
 *   kind     message                       ==  message
 *   schedule once 2026-08-30 11:00         ==  once 2026-08-30 11:00
 *   payload  "🔔 ... nhớ đóng ... nhé!"     !=  "... hôm nay nhớ đóng ... nhé."
 *
 * `payload` là văn xuôi tự do nên model viết lại mỗi lần một khác - khóa nào
 * có nó là trượt đúng ca cần bắt. `name` là nhãn NGẮN tóm tắt ý định nên ra
 * giống hệt nhau tới từng ký tự.
 *
 * VÌ SAO KHÔNG bỏ luôn `name` khỏi khóa (tức chặn mọi lịch trùng mốc giờ):
 * một người hoàn toàn có thể hẹn HAI việc khác nhau vào cùng một giờ ("11:00
 * nhắc đóng học phí" và "11:00 nhắc họp phụ huynh"). Bỏ `name` là chặn oan ca
 * đó. Đổi lại phải chấp nhận đây là PHỎNG ĐOÁN THEO TÊN: model đặt tên lệch
 * một chữ là trượt. `cungLich` bên dưới là lưới đỡ cho phần trượt đó - không
 * chặn, chỉ đưa thông tin để model tự nói cho người dùng biết.
 */

export type KetQuaTimTrung = {
  /**
   * Trùng KHÍT (cùng tên + cùng loại + cùng lịch). Caller trả job này về cho
   * model thay vì tạo thêm - đây là THÀNH CÔNG (trạng thái mong muốn đã có
   * sẵn), không phải lỗi.
   */
  trungKhit?: ScheduledJob;
  /**
   * Cùng lịch chạy nhưng KHÁC tên. Vẫn tạo bình thường; caller chỉ ghép thêm
   * một câu nhắc vào kết quả để model biết mà nói lại cho người dùng.
   */
  cungLich: ScheduledJob[];
};

/**
 * Chuẩn hóa tên trước khi so: bỏ khoảng trắng thừa hai đầu, gộp khoảng trắng
 * liên tiếp, hạ chữ thường.
 *
 * KHÔNG bỏ dấu tiếng Việt. Hai lời nhắc KHÁC NHAU mà chỉ khác nhau ở dấu là
 * ca không có thật, nên bỏ dấu chỉ mở thêm mặt va chạm mà không bắt thêm được
 * gì - cùng lý lẽ đã chốt ở `kb-search` cho chuyện bỏ dấu ("đóng" va "đồng").
 */
export function chuanHoaTen(ten: string): string {
  return ten.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Hai lịch có chạy vào ĐÚNG cùng nhịp/mốc không - so trên chính hình dạng đã lưu xuống DB */
function cungLichChay(job: ScheduledJob, schedule: ParsedSchedule): boolean {
  if (job.scheduleKind !== schedule.kind) return false;
  // Dùng `scheduleColumns` chứ không tự bóc từng nhánh: đó là CHÍNH hàm
  // `createJob` dùng để ghi xuống DB, nên hai bên không thể lệch cách hiểu.
  const cols = scheduleColumns(schedule);
  return (
    job.runAt === cols.runAt &&
    job.everyMinutes === cols.everyMinutes &&
    job.cronExpr === cols.cronExpr
  );
}

export function timLichHenTrung(p: {
  jobs: ScheduledJob[];
  name: string;
  kind: JobKind;
  schedule: ParsedSchedule;
}): KetQuaTimTrung {
  // CHỈ xét job THẬT SỰ SẮP CHẠY. Job đã tắt, hoặc còn bật mà mất mốc chạy kế
  // (`next_run_at = NULL`), sẽ không bao giờ bắn - người dùng nhờ đặt lại lịch
  // đó là yêu cầu HỢP LỆ, chặn mới là sai.
  const sapChay = p.jobs.filter((j) => j.enabled && j.nextRunAt !== null);
  const cungLich = sapChay.filter((j) => j.kind === p.kind && cungLichChay(j, p.schedule));

  const tenCanTim = chuanHoaTen(p.name);
  const trungKhit = cungLich.find((j) => chuanHoaTen(j.name) === tenCanTim);

  return {
    trungKhit,
    // Bỏ chính job trùng khít ra khỏi danh sách "cùng lịch khác tên" - nó đã
    // được báo bằng một đường riêng, kể lại lần nữa chỉ làm model rối.
    cungLich: cungLich.filter((j) => j.id !== trungKhit?.id),
  };
}
