import { APICallError, RetryError } from "ai";
import { LoiCauHinhLlm } from "./llm-config-error.js";

/**
 * Bóc lớp bọc `RetryError` của SDK.
 *
 * ĐÂY LÀ BƯỚC KHÔNG ĐƯỢC QUÊN. Với mọi lỗi mà SDK coi là thử lại được (429,
 * 5xx), thứ ném ra khỏi `generateText` KHÔNG phải `APICallError` mà là
 * `RetryError` với thông báo "Failed after 3 attempts. Last error: ...".
 * RetryError không có `statusCode`, nên bộ phân loại đọc thẳng sẽ luôn ra
 * `unknown` - tức là mù hoàn toàn với đúng hai loại lỗi hay gặp nhất.
 *
 * Đã đo trên `ai@7.0.37` với `maxRetries: 2`: HTTP 429 và 500 cho ra 3 lần gọi
 * rồi ném `RetryError`; 401 và 400 cho 1 lần gọi và ném thẳng `APICallError`.
 */
function bocLoi(err: unknown): unknown {
  if (RetryError.isInstance(err) && err.lastError !== undefined) return err.lastError;
  return err;
}

/**
 * Phân loại lỗi provider để mỗi loại được chữa đúng cách.
 *
 * Trước module này mọi thứ đi chung một đường: `maxRetries: 2` mù, cộng đúng
 * hai nhánh đặc thù (completion rỗng, provider từ chối ảnh). Hết quota, context
 * tràn, sai khóa và mạng chập bị xử lý y như nhau - mà retry sai loại là CÓ
 * HẠI, không trung tính: sai khóa mà thử lại 2 lần chỉ làm chậm gấp ba rồi vẫn
 * hỏng, còn hết quota mà đâm lại ngay có thể bị siết thêm.
 *
 * Cùng họ với `vision-rejection-fallback.ts` (bộ phân loại cho ĐÚNG MỘT loại
 * lỗi) - mở rộng họ đó chứ không dựng hệ song song.
 *
 * Module THUẦN: không log, không đọc env, không chạm DB.
 */

export type LoaiLoiProvider =
  /**
   * CHÍNH MÌNH chưa cấu hình xong (thiếu API key / model / base URL), chưa hề
   * gọi ra tới provider. Thử lại VÔ ÍCH và chờ cũng vô ích.
   *
   * Tách khỏi `auth` vì hai bên chữa ở hai nơi khác nhau: `auth` là khóa SAI
   * (đã nhập rồi, provider từ chối), còn đây là CHƯA NHẬP. Câu báo cho người
   * nhắn cũng phải khác.
   */
  | "cau_hinh"
  /** 429 - hết quota hoặc bị siết nhịp. Chờ rồi thử lại có ích. */
  | "rate_limit"
  /** Input vượt cửa sổ ngữ cảnh. Cắt bớt rồi thử lại có ích. */
  | "context_overflow"
  /** 401/403 - sai khóa hoặc không có quyền. Thử lại VÔ ÍCH. */
  | "auth"
  /** 5xx, mạng chập, timeout. Thử lại có ích - `maxRetries` của SDK đã lo. */
  | "transient"
  /** Không nhận ra. Xử như `transient` (hỏng an toàn), nhưng log riêng để còn biết mà bổ sung. */
  | "unknown";

/**
 * Dấu hiệu context tràn trong THÔNG BÁO lỗi.
 *
 * Phải khớp chuỗi vì không provider nào có mã riêng cho ca này - tất cả đều
 * trả 400 chung với các lỗi tham số khác. Danh sách gom từ cách diễn đạt thật
 * của OpenAI, Anthropic và các gateway tương thích.
 */
const DAU_HIEU_TRAN_CONTEXT = [
  "context length",
  "context_length",
  "context window",
  "maximum context",
  "too many tokens",
  "too long",
  "prompt is too long",
  "reduce the length",
  "exceeds the maximum",
];

/** Lỗi TẦNG MẠNG - chưa tới được provider, hoặc đứt giữa chừng */
const DAU_HIEU_MANG = [
  "econnreset",
  "econnrefused",
  "etimedout",
  "enotfound",
  "eai_again",
  "epipe",
  "socket hang up",
  "fetch failed",
  "network error",
  "aborted",
  "timeout",
];

/** Gom mọi chỗ có thể chứa mô tả lỗi thành một chuỗi thường để dò */
function chuoiLoi(err: unknown): string {
  if (typeof err === "string") return err.toLowerCase();
  if (!err || typeof err !== "object") return "";
  const e = err as { message?: unknown; responseBody?: unknown; cause?: unknown };
  const phan = [
    typeof e.message === "string" ? e.message : "",
    typeof e.responseBody === "string" ? e.responseBody : "",
    // Lỗi mạng thật thường bị bọc: `TypeError: fetch failed` với `cause` mới là
    // `Error: connect ECONNREFUSED`. Không đọc cause là bỏ sót đúng ca hay gặp nhất.
    e.cause && typeof e.cause === "object" && typeof (e.cause as { message?: unknown }).message === "string"
      ? (e.cause as { message: string }).message
      : "",
  ];
  return phan.join(" ").toLowerCase();
}

/** Mã HTTP nếu có. `APICallError` của SDK mang sẵn; lỗi khác thì dò vài tên trường quen thuộc. */
export function maHttpCua(raw: unknown): number | undefined {
  const err = bocLoi(raw);
  if (APICallError.isInstance(err)) return err.statusCode;
  if (!err || typeof err !== "object") return undefined;
  const e = err as { statusCode?: unknown; status?: unknown };
  for (const v of [e.statusCode, e.status]) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

export function phanLoaiLoiProvider(raw: unknown): LoaiLoiProvider {
  const err = bocLoi(raw);

  // XÉT TRƯỚC mọi thứ khác. Đây là lỗi của chính mình, chưa hề gọi ra ngoài nên
  // không có mã HTTP nào để mà đọc - để nó rơi xuống dưới là ra `unknown`, và
  // `unknown` được xử như `transient` nên người nhắn nhận câu "thử lại sau ít
  // phút". Đó là nói dối: chưa nhập cấu hình thì chờ bao lâu cũng không tự hết.
  //
  // Trạng thái này KHÔNG hiếm nữa kể từ khi `.env` chỉ còn một biến bắt buộc:
  // bot khởi động được khi chưa cấu hình gì, nên đây là trạng thái mặc định của
  // lần cài đầu, và mỗi tin nhắn tới đều đi qua đây.
  if (LoiCauHinhLlm.isInstance(err)) return "cau_hinh";

  const ma = maHttpCua(err);
  const chuoi = chuoiLoi(err);

  // Mã HTTP trước, chuỗi sau: mã là dữ liệu có cấu trúc do provider gửi, còn
  // chuỗi thì mỗi nơi viết một kiểu và đổi bất cứ lúc nào.
  if (ma === 429) return "rate_limit";
  if (ma === 401 || ma === 403) return "auth";

  // Context tràn LUÔN là 400 chung với lỗi tham số khác, nên chỉ nhận ra được
  // qua thông báo. Chỉ dò trong nhóm 4xx để một lỗi 500 có chữ "too long"
  // trong thân trang HTML không bị bắt nhầm.
  if (ma !== undefined && ma >= 400 && ma < 500) {
    if (DAU_HIEU_TRAN_CONTEXT.some((d) => chuoi.includes(d))) return "context_overflow";
    return "unknown";
  }

  if (ma !== undefined && ma >= 500) return "transient";

  // Không có mã: hoặc là lỗi mạng (chưa tới được provider), hoặc là thứ khác.
  // Vẫn dò dấu hiệu tràn context vì có gateway ném lỗi không kèm mã.
  if (DAU_HIEU_TRAN_CONTEXT.some((d) => chuoi.includes(d))) return "context_overflow";
  if (DAU_HIEU_MANG.some((d) => chuoi.includes(d))) return "transient";
  return "unknown";
}

/** Loại nào thì thử lại mới có ích - `unknown` cho thử vì hỏng an toàn */
export function nenThuLai(loai: LoaiLoiProvider): boolean {
  return loai !== "auth" && loai !== "cau_hinh";
}

/**
 * Số giây provider bảo phải chờ (`Retry-After`), nếu có.
 *
 * Header này có thể là số giây hoặc một mốc HTTP-date. Kẹp trần 60 giây: chờ
 * lâu hơn thì lượt đã chạm `LLM_TURN_TIMEOUT_MS` và khóa thread, thà báo lỗi
 * sớm cho người nhắn còn hơn để họ ngồi đợi vô vọng.
 */
export function giayChoLai(raw: unknown): number | undefined {
  const err = bocLoi(raw);
  if (!APICallError.isInstance(err)) return undefined;
  const header = err.responseHeaders?.["retry-after"];
  if (!header) return undefined;

  const giay = Number(header);
  if (Number.isFinite(giay) && giay >= 0) return Math.min(giay, 60);

  const moc = Date.parse(header);
  if (Number.isNaN(moc)) return undefined;
  return Math.min(Math.max(0, Math.ceil((moc - Date.now()) / 1000)), 60);
}
