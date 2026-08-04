/**
 * Bộ case eval chạy MODEL THẬT - chỗ gom các nhóm case lại.
 *
 * Ban đầu để chung một file (mỗi case ~15 dòng, tách nhỏ là vụn vặt) kèm hẹn
 * "tách khi vượt 200 dòng". Thêm nhóm memory thì chạm 255 dòng nên tách thật,
 * chia theo VIỆC ĐANG ĐO chứ không chia đều số dòng: dùng tool, cách nói
 * chuyện, trí nhớ.
 *
 * TẮT TOOL ĐẮT TIỀN theo từng case (`create_image`, `create_word_document`,
 * `create_excel_file`) ở những case không cần chúng. Hai lý do, lý do thứ hai
 * mới là chính:
 *
 *   - Tiền: một lần gọi vẽ ảnh là tiền thật và 60-135 giây chờ.
 *   - ĐỘ ĐÚNG của phép đo: case "định dạng" hỏi "lập bảng so sánh" mà để
 *     `create_excel_file` bật thì model rất có thể đi tạo file Excel và trả về
 *     một câu ngắn "đã gửi file" - lúc đó khẳng định "text cuối không còn
 *     markdown" xanh mà chẳng đo được gì.
 */
import type { EvalCase } from "./eval-case-type.js";
import { CASE_TOOL } from "./eval-cases-tool.js";
import { CASE_CACH_NOI } from "./eval-cases-cach-noi.js";
import { CASE_MEMORY } from "./eval-cases-memory.js";

export const EVAL_CASES: EvalCase[] = [...CASE_TOOL, ...CASE_CACH_NOI, ...CASE_MEMORY];
