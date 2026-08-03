import { db } from "../conversation/database.js";
import { isValidTimezone } from "../shared/current-datetime.js";
import { env } from "./env.js";
import { TUNING_DEFS, type TuningKey } from "./tuning-definitions.js";

/**
 * Giá trị hiệu lực của các tham số chỉnh được: DB (nhập từ dashboard) đè lên
 * `.env`. Chưa đặt trên dashboard thì rơi về env, nên hành vi mặc định không đổi
 * và file `.env` cũ vẫn còn tác dụng.
 *
 * ĐỌC LẠI MỖI LẦN GỌI, không cache: đó là cả mục đích của việc đưa lên web.
 * Cache ở đây là quay về đúng chỗ cũ - phải khởi động lại mới thấy thay đổi.
 * `runtime_settings` là bảng nhỏ đọc bằng câu lệnh đã chuẩn bị sẵn nên rẻ.
 *
 * Ràng buộc GIỮA các tham số nằm ở `validateTuning`, không nằm ở giao diện: đặt
 * trần lượt thấp hơn trần vẽ ảnh là giết ngang lượt vẽ hợp lệ, mà nhìn hai ô
 * nhập rời nhau thì không ai nhận ra.
 */

const PREFIX = "tuning_";

const getStmt = db.prepare("SELECT value FROM runtime_settings WHERE key = ?");
const setStmt = db.prepare(`
  INSERT INTO runtime_settings (key, value, updated_at)
  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const delStmt = db.prepare("DELETE FROM runtime_settings WHERE key = ?");

function readRaw(key: TuningKey): string | undefined {
  return (getStmt.get(PREFIX + key) as { value: string } | undefined)?.value;
}

/** Giá trị đang hiệu lực. Giá trị hỏng trong DB bị bỏ qua thay vì làm chết bot. */
export function getTuning<K extends TuningKey>(key: K): (typeof env)[K] {
  const def = TUNING_DEFS[key]!;
  const raw = readRaw(key);
  const fallback = env[key];
  if (raw === undefined) return fallback;

  if (def.kind === "boolean") return (raw === "true") as (typeof env)[K];
  if (def.kind === "enum") {
    return (def.options.includes(raw) ? raw : fallback) as (typeof env)[K];
  }
  // Kiểm lại lúc ĐỌC chứ không chỉ lúc ghi. Một zone hỏng lọt vào DB (sửa tay,
  // hoặc bản cũ ghi trước khi có kiểm) mà cứ thế trả ra thì luxon rơi về UTC
  // âm thầm - lịch hẹn lệch 7 tiếng mà không ai thấy lỗi ở đâu.
  if (def.kind === "timezone") {
    return (isValidTimezone(raw) ? raw : fallback) as (typeof env)[K];
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < def.min || num > def.max) return fallback;
  return num as (typeof env)[K];
}

/**
 * Múi giờ đang hiệu lực. Có hàm riêng vì đây là tham số bị đọc ở nhiều chỗ
 * nhất (18 điểm gọi): để mỗi nơi tự `getTuning("BOT_TIMEZONE")` thì sớm muộn
 * có chỗ quên và tiếp tục đọc `env` - lúc đó dashboard đổi múi giờ mà một nửa
 * hệ thống vẫn chạy theo giờ cũ, kiểu lệch âm thầm rất khó truy.
 */
export function botTimeZone(): string {
  return getTuning("BOT_TIMEZONE");
}

export type TuningValue = number | boolean | string;

/**
 * Toàn bộ giá trị hiệu lực + cái nào đang lấy từ env (để giao diện nói rõ).
 *
 * `macDinh` = giá trị KHI KHÔNG CÓ dòng đè nào, tức `.env` nếu người deploy có
 * đặt, còn không thì `.default()` của schema. Trình duyệt cần nó để biết lúc
 * nào nên gửi `null` (xóa dòng đè) thay vì ghi một giá trị trùng y hệt mặc
 * định. Thiếu nó thì bật/tắt một công tắc rồi bật lại vẫn để lại dòng đè, và
 * giao diện báo "đã chỉnh" mãi dù giá trị không khác gì mặc định.
 */
export function listTuning(): {
  key: string;
  value: TuningValue;
  macDinh: TuningValue;
  fromEnv: boolean;
}[] {
  return Object.keys(TUNING_DEFS).map((key) => ({
    key,
    value: getTuning(key as TuningKey) as TuningValue,
    macDinh: env[key as TuningKey] as TuningValue,
    fromEnv: readRaw(key as TuningKey) === undefined,
  }));
}

/**
 * Ràng buộc GIỮA các tham số - thứ nhìn hai ô nhập rời nhau thì không ai nhận ra.
 *
 * Mỗi luật khai rõ nó liên quan tới những ô nào, và CHỈ áp khi người dùng đang
 * đổi một trong số đó. Nếu không: một cấu hình sẵn có đã lệch (đặt tay trong
 * `.env`, hoặc mình thêm luật mới sau này) sẽ chặn MỌI lần lưu, khóa cứng cả
 * trang Cấu hình và người dùng không còn đường nào sửa lại. Đã dính lúc test:
 * môi trường test hạ trần token xuống 2048 nên không lưu nổi ô nào khác.
 */
const LUAT_CHEO: { keys: TuningKey[]; check: (so: (k: TuningKey) => number) => string | null }[] = [
  {
    keys: ["LLM_TURN_TIMEOUT_MS", "IMAGE_GEN_TIMEOUT_MS"],
    check: (so) =>
      so("LLM_TURN_TIMEOUT_MS") <= so("IMAGE_GEN_TIMEOUT_MS")
        ? "Trần thời gian mỗi lượt phải lớn hơn trần thời gian mỗi ảnh - nếu không, lượt bị cắt trước khi ảnh kịp xong."
        : null,
  },
  {
    keys: ["IMAGE_GEN_STALL_MS", "IMAGE_GEN_TIMEOUT_MS"],
    check: (so) =>
      so("IMAGE_GEN_STALL_MS") >= so("IMAGE_GEN_TIMEOUT_MS")
        ? "Thời gian im lặng phải nhỏ hơn trần thời gian mỗi ảnh, nếu không nó không bao giờ có tác dụng."
        : null,
  },
  {
    keys: ["SEND_DELAY_MIN_MS", "SEND_DELAY_MAX_MS"],
    check: (so) =>
      so("SEND_DELAY_MIN_MS") > so("SEND_DELAY_MAX_MS")
        ? "Giãn nhịp gửi tối thiểu không được lớn hơn tối đa."
        : null,
  },
  {
    // Bot chỉ dùng tới 70% trần context (chừa chỗ cho phần model viết ra và cho
    // kết quả tool cộng dồn - xem `nganSachAnToan`). Trần mà không lớn hơn hẳn
    // phần model được phép viết ra thì phần chừa đó đã bị output ăn sạch trước
    // khi có chữ nào của ngữ cảnh.
    keys: ["LLM_CONTEXT_WINDOW", "LLM_MAX_OUTPUT_TOKENS"],
    check: (so) =>
      so("LLM_CONTEXT_WINDOW") * 0.3 <= so("LLM_MAX_OUTPUT_TOKENS")
        ? "Trần token mỗi lần gọi quá thấp so với trần token bot viết ra: bot chừa 30% trần cho phần viết ra và cho kết quả công cụ, nên trần này phải lớn hơn khoảng 3,4 lần trần token viết ra."
        : null,
  },
  {
    // Bot viết cả nội dung file vào lệnh gọi công cụ nên trần ký tự tài liệu
    // phải nằm gọn trong trần token. Ước lượng thô 4 ký tự/token, chừa biên cho
    // phần suy nghĩ và câu trả lời.
    keys: ["DOCUMENT_MAX_CHARS", "LLM_MAX_OUTPUT_TOKENS"],
    check: (so) =>
      so("DOCUMENT_MAX_CHARS") / 4 > so("LLM_MAX_OUTPUT_TOKENS") * 0.7
        ? "Trần ký tự tài liệu quá lớn so với trần token bot viết ra - bot sẽ bị cắt giữa lúc tạo file và mất cả lượt."
        : null,
  },
];

/**
 * @param sau giá trị người dùng vừa đổi; ô không có ở đây lấy giá trị hiện tại,
 * nhờ vậy sửa một ô trong cặp vẫn kiểm được với ô còn lại.
 */
export function validateTuning(sau: Record<string, TuningValue>): string[] {
  const so = (k: TuningKey): number => Number(sau[k] ?? getTuning(k));
  const dangDoi = new Set(Object.keys(sau));
  const loi: string[] = [];
  for (const luat of LUAT_CHEO) {
    if (!luat.keys.some((k) => dangDoi.has(k))) continue;
    const cau = luat.check(so);
    if (cau) loi.push(cau);
  }
  return loi;
}

/** Đặt giá trị mới; `null` nghĩa là xóa đè, quay về giá trị trong `.env` */
export function setTuning(key: TuningKey, value: TuningValue | null): void {
  if (value === null) {
    delStmt.run(PREFIX + key);
    return;
  }
  setStmt.run(PREFIX + key, String(value));
}
