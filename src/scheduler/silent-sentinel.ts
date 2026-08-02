/**
 * Nhận diện sentinel `[SILENT]` trong câu trả lời của lượt agent theo lịch -
 * job kiểu "theo dõi có gì mới" (vd "mỗi sáng 7h tóm tắt tin công nghệ") không
 * phải lúc nào cũng có gì để báo, và nhắn "không có gì mới" mỗi sáng còn phiền
 * hơn im lặng.
 *
 * Chép luật `_is_cron_silence_response` của Hermes (`cron/scheduler.py`), thu
 * hẹp bộ token: Hermes còn nhận biến thể không ngoặc SILENT/NO_REPLY vì họ
 * từng dính model tự bỏ ngoặc (issue #51438, #46917). Dự án này chỉ dạy model
 * đúng một dạng "[SILENT]" trong prompt (xem CRON_HINT ở run-scheduled-job.ts)
 * nên chỉ cần nhận đúng token đó - thêm biến thể Hermes chưa quan sát thấy ở
 * đây là phòng thủ cho một vấn đề chưa từng xảy ra.
 *
 * Module THUẦN: không DB, không env, không logger.
 */

const SILENT_TOKEN = "[SILENT]";

/** Dòng (đã trim) CHỈ chứa đúng token, khoảng trắng bên trong không tính (vd "[ SILENT ]" vẫn khớp) */
function isExactToken(line: string): boolean {
  return line.trim().toUpperCase().replace(/\s+/g, "") === SILENT_TOKEN;
}

/**
 * Dòng này có phải CHỈ là nhãn sentinel không.
 *
 * Khác hẳn `isSilentResponse` bên dưới về CẤP ĐỘ: hàm kia phán xét CẢ câu trả
 * lời (nên có luật "mở đầu bằng [SILENT] thì nuốt cả câu"), hàm này chỉ nhìn
 * MỘT dòng. Dùng nhầm cấp là mất trắng nội dung: đem `isSilentResponse` đi lọc
 * từng dòng thì "[SILENT] là nhãn nội bộ, dùng để bot im lặng ạ" - một câu trả
 * lời hợp lệ khi người dùng hỏi về chính cái nhãn - bị vứt sạch.
 */
export function laDongSentinel(line: string): boolean {
  return isExactToken(line);
}

/**
 * Có nên NUỐT (không gửi) câu trả lời này không. Nhận khi:
 * - Toàn bộ câu trả lời (sau trim) chỉ là "[SILENT]"
 * - "[SILENT]" đứng RIÊNG ở dòng đầu hoặc dòng cuối (dòng khác có nội dung vẫn được -
 *   vd "2 tin mới đã lọc xong\n\n[SILENT]" là hợp lệ nếu model quên xoá nhãn)
 * - Câu trả lời MỞ ĐẦU bằng "[SILENT]" (dạng "[SILENT] Không có gì mới hôm nay")
 *
 * Token nằm GIỮA câu thì VẪN GỬI - "mình định [SILENT] nhưng đây là tóm tắt
 * hôm nay: ..." phải tới nơi, không được nuốt nhầm một câu trả lời thật.
 */
export function isSilentResponse(text: string): boolean {
  const stripped = text.trim();
  if (!stripped) return false;

  if (isExactToken(stripped)) return true;

  const lines = stripped.split(/\r?\n/).filter((ln) => ln.trim() !== "");
  if (lines.length > 0 && (isExactToken(lines[0]!) || isExactToken(lines[lines.length - 1]!))) {
    return true;
  }

  return stripped.toUpperCase().startsWith(SILENT_TOKEN);
}
