/**
 * Danh mục tham số chỉnh được từ dashboard, thay vì phải mở `.env` rồi khởi
 * động lại bot.
 *
 * MỘT nguồn sự thật cho cả ba phía: giá trị hiệu lực lúc chạy, ràng buộc khi
 * lưu, và giao diện (nhãn + gợi ý + nhóm đều lấy từ đây). Thêm tham số mới chỉ
 * cần thêm một dòng ở file này - không phải sửa route, không phải sửa web.
 *
 * Chỉ đưa vào đây thứ đọc LẠI mỗi lần dùng. Tham số đọc một lần lúc khởi động
 * (cổng dashboard, mật khẩu, đường log) thì đổi nóng không có tác dụng, để
 * nguyên trong `.env` còn trung thực hơn là bày một ô nhập không ăn thua.
 *
 * `min`/`max` khớp đúng schema Zod trong `env.ts`: hai nơi lệch nhau thì hoặc
 * dashboard cho nhập giá trị mà env từ chối, hoặc chặn oan giá trị hợp lệ.
 */

import type { env } from "./env.js";

/** Tên tham số trùng KHỚP tên biến môi trường - env chính là giá trị mặc định */
export type TuningKey = keyof typeof TUNING_BY_KEY;

export type TuningGroup = {
  id: string;
  title: string;
  /** Câu giải thích nhóm này ảnh hưởng tới cái gì */
  hint: string;
};

export type TuningDef = {
  group: string;
  label: string;
  hint: string;
} & (
  | { kind: "number"; min: number; max: number; unit?: string }
  | { kind: "boolean" }
  | { kind: "enum"; options: readonly string[] }
);

export const TUNING_GROUPS: TuningGroup[] = [
  { id: "luot", title: "Lượt trả lời", hint: "Bot được phép làm bao nhiêu, trong bao lâu, nghĩ kỹ tới đâu" },
  { id: "ngu-canh", title: "Ngữ cảnh và trí nhớ", hint: "Bot nhớ lại bao nhiêu trước khi trả lời" },
  { id: "web", title: "Tra cứu web", hint: "Số nguồn và lượng chữ đọc từ mỗi trang" },
  { id: "file", title: "Tạo file Word/Excel", hint: "Trần kích thước file và số file mỗi giờ" },
  { id: "anh", title: "Vẽ ảnh", hint: "Số ảnh mỗi giờ và thời gian chờ nhà cung cấp" },
  { id: "gui-tin", title: "Gửi tin trên Zalo", hint: "Cách bot chia tin và giãn nhịp gửi cho tự nhiên" },
  { id: "don-dep", title: "Trace và dọn dẹp", hint: "Ghi lại bao nhiêu, giữ trong bao lâu" },
];

const TUNING_BY_KEY = {
  // --- Lượt trả lời ---
  LLM_MAX_STEPS: {
    kind: "number",
    group: "luot",
    label: "Số bước tối đa mỗi lượt",
    hint: "Một bước là một lần bot nói chuyện với model, có thể gọi nhiều công cụ cùng lúc. Trò chuyện thường tốn 1 bước, tra cứu web 3-5 bước. Hết bước mà chưa xong thì bot chạy thêm một lượt chốt để trả lời bằng dữ liệu đã có.",
    min: 1,
    max: 30,
    unit: "bước",
  },
  LLM_MAX_OUTPUT_TOKENS: {
    kind: "number",
    group: "luot",
    label: "Trần token bot viết ra",
    hint: "Tính cho TỪNG bước, không phải cả lượt. Phải đủ chỗ cho bước tốn nhất là tạo file: bot viết cả nội dung file vào lệnh gọi công cụ. Hạ xuống dưới 12.000 thì phải hạ trần ký tự tài liệu theo.",
    min: 256,
    max: 200_000,
    unit: "token",
  },
  LLM_TURN_TIMEOUT_MS: {
    kind: "number",
    group: "luot",
    label: "Trần thời gian mỗi lượt",
    hint: "Bỏ cuộc khi cả lượt chạy quá lâu, tránh một cuộc trò chuyện bị treo cứng làm mọi tin nhắn sau phải xếp hàng. PHẢI lớn hơn thời gian chờ vẽ ảnh, vì lúc vẽ ảnh cũng tính vào lượt.",
    min: 60_000,
    max: 3_600_000,
    unit: "ms",
  },
  LLM_REASONING_EFFORT: {
    kind: "enum",
    group: "luot",
    label: "Mức suy nghĩ mặc định",
    hint: "Không bật thì bot lướt qua dữ liệu dài mà không nghĩ từng bước - đã dính thật ở vụ dò vé số: dữ liệu đã có trong ngữ cảnh mà bot vẫn bảo chưa lấy được. Từng agent đặt riêng được, để trống là theo mức này.",
    options: ["off", "low", "medium", "high", "xhigh"],
  },

  // --- Ngữ cảnh và trí nhớ ---
  HISTORY_CONTEXT_LIMIT: {
    kind: "number",
    group: "ngu-canh",
    label: "Số tin nhắn nạp lại",
    hint: "Bot đọc lại bấy nhiêu tin gần nhất mỗi lượt. Tăng thì bot nhớ dai hơn nhưng mỗi lượt tốn thêm token, và mỗi bước đều gửi lại toàn bộ.",
    min: 1,
    max: 200,
    unit: "tin",
  },
  HISTORY_IMAGE_CONTEXT_LIMIT: {
    kind: "number",
    group: "ngu-canh",
    label: "Số ảnh cũ kèm lại",
    hint: "Để bot xem lại được ảnh gửi vài phút trước. Ảnh rất tốn token nên đừng để cao.",
    min: 0,
    max: 20,
    unit: "ảnh",
  },
  SUMMARY_TRIGGER_MESSAGES: {
    kind: "number",
    group: "ngu-canh",
    label: "Tóm tắt sau mỗi",
    hint: "Cứ bấy nhiêu tin thì bot tóm tắt lại đoạn đã trôi khỏi cửa sổ nhớ, để chuyện cũ không mất hẳn.",
    min: 5,
    max: 500,
    unit: "tin",
  },
  MEMORY_MAX_FACTS_PER_SUBJECT: {
    kind: "number",
    group: "ngu-canh",
    label: "Số điều ghi nhớ mỗi người",
    hint: "Trần số mẩu thông tin bot tự lưu về một người.",
    min: 1,
    max: 1000,
    unit: "mục",
  },
  HISTORY_MAX_MESSAGES_PER_THREAD: {
    kind: "number",
    group: "ngu-canh",
    label: "Giữ lịch sử mỗi cuộc trò chuyện",
    hint: "Tin cũ hơn mức này bị xóa khỏi cơ sở dữ liệu. Khác với số tin nạp lại: đây là lưu trữ, kia là thứ bot đọc.",
    min: 20,
    max: 100_000,
    unit: "tin",
  },

  // --- Tra cứu web ---
  WEB_SEARCH_MAX_RESULTS: {
    kind: "number",
    group: "web",
    label: "Số kết quả tìm kiếm",
    hint: "Mỗi lần tìm trả về bấy nhiêu đường dẫn để bot chọn đọc tiếp.",
    min: 1,
    max: 10,
    unit: "kết quả",
  },
  WEB_FETCH_MAX_CHARS: {
    kind: "number",
    group: "web",
    label: "Trần chữ đọc từ mỗi trang",
    hint: "Cắt bớt trang quá dài. Đặt thấp quá thì phần cần tìm nằm sau chỗ cắt - đã dính thật: bảng kết quả xổ số nằm sau ký tự thứ 8.300.",
    min: 2000,
    max: 100_000,
    unit: "ký tự",
  },

  // --- Tạo file ---
  DOCUMENT_MAX_PER_HOUR: {
    kind: "number",
    group: "file",
    label: "Số file mỗi giờ",
    hint: "Chặn việc đốt token và gửi file dồn dập.",
    min: 1,
    max: 200,
    unit: "file",
  },
  DOCUMENT_MAX_BLOCKS: {
    kind: "number",
    group: "file",
    label: "Số phần tối đa",
    hint: "Mỗi tiêu đề, đoạn văn hay bảng tính là một phần.",
    min: 1,
    max: 500,
    unit: "phần",
  },
  DOCUMENT_MAX_ROWS: {
    kind: "number",
    group: "file",
    label: "Số dòng mỗi bảng",
    hint: "Trần cho một bảng trong Word hoặc một sheet Excel.",
    min: 1,
    max: 5000,
    unit: "dòng",
  },
  DOCUMENT_MAX_CHARS: {
    kind: "number",
    group: "file",
    label: "Trần ký tự cả file",
    hint: "Phải nhỏ hơn trần token bot viết ra, nếu không bot bị cắt giữa chừng khi đang viết nội dung file và mất cả lượt.",
    min: 500,
    max: 500_000,
    unit: "ký tự",
  },
  DOCUMENT_MAX_SHEETS: {
    kind: "number",
    group: "file",
    label: "Số sheet mỗi file Excel",
    hint: "",
    min: 1,
    max: 50,
    unit: "sheet",
  },

  // --- Vẽ ảnh ---
  IMAGE_GEN_MAX_PER_HOUR: {
    kind: "number",
    group: "anh",
    label: "Số ảnh mỗi giờ",
    hint: "Vẽ ảnh tốn tiền và tốn thời gian, nên có trần theo giờ.",
    min: 1,
    max: 100,
    unit: "ảnh",
  },
  IMAGE_GEN_STALL_MS: {
    kind: "number",
    group: "anh",
    label: "Bỏ cuộc khi im lặng quá",
    hint: "Đếm khoảng LẶNG giữa hai tín hiệu, không phải tổng thời gian. Nhà cung cấp còn gửi tín hiệu sống thì cứ chờ tiếp, dù ảnh khó vẽ mất vài phút.",
    min: 30_000,
    max: 300_000,
    unit: "ms",
  },
  IMAGE_GEN_TIMEOUT_MS: {
    kind: "number",
    group: "anh",
    label: "Trần thời gian mỗi ảnh",
    hint: "Chặn trên cho cả lần vẽ. Phải nhỏ hơn trần thời gian mỗi lượt, nếu không lượt bị cắt trước khi ảnh kịp xong.",
    min: 30_000,
    max: 1_800_000,
    unit: "ms",
  },

  // --- Gửi tin ---
  ZALO_MAX_MESSAGE_CHARS: {
    kind: "number",
    group: "gui-tin",
    label: "Ký tự mỗi tin",
    hint: "Zalo chặn tin quá dài nên câu trả lời dài bị chia nhỏ.",
    min: 500,
    max: 4000,
    unit: "ký tự",
  },
  ZALO_MAX_MESSAGE_PARTS: {
    kind: "number",
    group: "gui-tin",
    label: "Số đoạn tối đa",
    hint: "Câu trả lời dài hơn mức này thì phần dư bị bỏ, tránh bot xả một tràng chục tin liên tiếp.",
    min: 1,
    max: 20,
    unit: "đoạn",
  },
  MESSAGE_BATCH_DEBOUNCE_MS: {
    kind: "number",
    group: "gui-tin",
    label: "Chờ gộp tin",
    hint: "Người ta hay gửi ảnh rồi mới gõ chú thích. Chờ một nhịp rồi mới xử lý thì bot hiểu trọn ý thay vì trả lời hai lần.",
    min: 0,
    max: 15_000,
    unit: "ms",
  },
  SEND_DELAY_MIN_MS: {
    kind: "number",
    group: "gui-tin",
    label: "Giãn nhịp gửi tối thiểu",
    hint: "Trả lời tức thì mọi lúc trông rất máy móc. Chờ ngẫu nhiên trong khoảng này trước khi gửi.",
    min: 0,
    max: 60_000,
    unit: "ms",
  },
  SEND_DELAY_MAX_MS: {
    kind: "number",
    group: "gui-tin",
    label: "Giãn nhịp gửi tối đa",
    hint: "Phải lớn hơn hoặc bằng mức tối thiểu.",
    min: 0,
    max: 60_000,
    unit: "ms",
  },
  TYPING_REFRESH_MS: {
    kind: "number",
    group: "gui-tin",
    label: "Nhịp báo đang nhập",
    hint: "Zalo không có lệnh tắt chỉ báo nên phải bắn lại theo chu kỳ để giữ chữ đang nhập.",
    min: 1000,
    max: 10_000,
    unit: "ms",
  },

  // --- Trace và dọn dẹp ---
  AGENT_TRACE_ENABLED: {
    kind: "boolean",
    group: "don-dep",
    label: "Ghi trace từng bước",
    hint: "Lưu lại bot đã nghĩ gì, gọi công cụ nào với tham số gì. Tắt thì trang Trace không có dữ liệu mới.",
  },
  AGENT_TRACE_MAX_CHARS: {
    kind: "number",
    group: "don-dep",
    label: "Trần chữ mỗi khối trace",
    hint: "Cắt bớt nội dung dài trong trace, có ghi kèm độ dài thật để biết mình đang mất bao nhiêu.",
    min: 50,
    max: 20_000,
    unit: "ký tự",
  },
  AGENT_TRACE_RETENTION_DAYS: {
    kind: "number",
    group: "don-dep",
    label: "Giữ trace",
    hint: "Bảng trace phình nhanh nhất trong cơ sở dữ liệu nên có dọn tự động.",
    min: 1,
    max: 365,
    unit: "ngày",
  },
  MEDIA_RETENTION_DAYS: {
    kind: "number",
    group: "don-dep",
    label: "Giữ ảnh đã tải",
    hint: "Ảnh người dùng gửi được lưu lại để bot xem lại ở lượt sau, quá hạn thì xóa cho nhẹ đĩa.",
    min: 1,
    max: 365,
    unit: "ngày",
  },
} as const satisfies Record<string, TuningDef>;

export const TUNING_DEFS: Record<string, TuningDef> = TUNING_BY_KEY;

/** Kiểm tra lúc biên dịch: mọi key phải là biến môi trường có thật */
type _KhopVoiEnv = TuningKey extends keyof typeof env ? true : never;
const _kiemTra: _KhopVoiEnv = true;
void _kiemTra;
