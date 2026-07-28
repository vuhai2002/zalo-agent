/**
 * Ép lỗi về hình dạng AN TOÀN trước khi ghi log.
 *
 * Vì sao cần: bộ serialize mặc định của pino chép MỌI thuộc tính enumerable của
 * error. `APICallError` của AI SDK gắn thẳng `requestBodyValues` = nguyên body
 * đã gửi lên provider, tức system prompt + toàn bộ hội thoại + ảnh dạng base64.
 * Đo thật: một lỗi 429 giả với ảnh 400 ký tự base64 làm dòng log phình từ 17 lên
 * 1338 ký tự, có đủ cả system prompt lẫn chuỗi ảnh. Với ảnh Zalo thật (300 KB)
 * thì mỗi lần provider trả 4xx là ~400 KB dữ liệu riêng tư nằm plaintext trong
 * `data/logs/`. Sidecar đọc ảnh chạy Gemini free tier nên 429 là chuyện thường ngày.
 *
 * Kèm hai tác hại nữa: hàm đọc log của dashboard chỉ lấy 4 MB cuối file nên một
 * dòng khổng lồ ở cuối làm cả ngày log biến mất khỏi giao diện; và log xoay vòng
 * chỉ giới hạn theo SỐ NGÀY, không theo dung lượng.
 *
 * Dùng DANH SÁCH CHO PHÉP chứ không phải danh sách cấm: bản SDK sau thêm trường
 * mới chứa body thì cách cấm sẽ âm thầm để lọt, còn cách này thì không.
 */

/** Trường giữ lại - đủ để chẩn đoán, không mang nội dung hội thoại */
const TRUONG_AN_TOAN = [
  "message",
  "name",
  "code",
  "errno",
  "syscall",
  "statusCode",
  "url",
  "isRetryable",
  "responseHeaders",
] as const;

/** Stack dài cỡ nghìn ký tự là bình thường; cắt để một dòng log không nuốt màn hình */
const STACK_TOI_DA = 2000;

/** Bọc `cause` lồng nhau nhưng không đi sâu vô hạn (lỗi có thể tự tham chiếu) */
const DO_SAU_TOI_DA = 3;

export type SafeError = Record<string, unknown>;

export function serializeErrorSafely(err: unknown, doSau = 0): SafeError {
  if (err === null || err === undefined) return { message: String(err) };

  if (typeof err !== "object") return { message: String(err) };

  const nguon = err as Record<string, unknown>;
  const ra: SafeError = {
    // pino-std-serializers đặt `type` từ tên constructor - giữ đúng quy ước đó
    // để chỗ đọc log không phải xử lý hai hình dạng
    type: (err as object).constructor?.name ?? "Error",
  };

  for (const khoa of TRUONG_AN_TOAN) {
    const gt = nguon[khoa];
    if (gt === undefined) continue;
    // Chỉ nhận giá trị nguyên thủy: `responseHeaders` là object phẳng nhưng
    // trường lạ nào đó có thể là object khổng lồ
    ra[khoa] = typeof gt === "object" ? safeJson(gt) : gt;
  }

  // `message` của Error là non-enumerable nên vòng lặp trên không lấy được -
  // đúng cái cần đọc nhất lại là cái bị bỏ sót
  if (err instanceof Error) {
    ra.message = err.message;
    ra.type = err.constructor?.name ?? "Error";
    if (err.stack) {
      ra.stack = err.stack.length > STACK_TOI_DA ? `${err.stack.slice(0, STACK_TOI_DA)}...` : err.stack;
    }
  }

  const cause = nguon.cause;
  if (cause !== undefined && doSau < DO_SAU_TOI_DA) {
    ra.cause = serializeErrorSafely(cause, doSau + 1);
  }

  return ra;
}

/** Object nhỏ thì giữ nguyên nội dung, to thì chỉ ghi kích thước */
function safeJson(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 500 ? `[object ${text.length} ký tự - đã lược]` : value;
  } catch {
    return "[object không stringify được]";
  }
}
