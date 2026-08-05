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
  /**
   * Câu dẫn ngắn hiện ở nav trái. TÁCH khỏi `hint` vì hai chỗ cần độ dài khác
   * hẳn nhau: nav là ô hẹp (2 dòng là hết chỗ), panel chi tiết có cả chiều
   * ngang để giải thích cho đủ ý. Dùng chung một câu thì hoặc nav bị cắt chữ,
   * hoặc panel cụt lủn.
   */
  navHint: string;
};

export type TuningDef = {
  group: string;
  label: string;
  hint: string;
} & (
  | { kind: "number"; min: number; max: number; unit?: string }
  | { kind: "boolean" }
  | { kind: "enum"; options: readonly string[] }
  // Danh sách chọn quá dài để nhét vào `enum` (418 tên timezone IANA) nên
  // KHÔNG gửi options qua JSON - trình duyệt tự dựng bằng
  // `Intl.supportedValuesOf("timeZone")`, đúng bộ dữ liệu server cũng dùng để
  // kiểm hợp lệ. Gõ tay tên zone là đường sai chính tả rồi lệch giờ âm thầm.
  | { kind: "timezone" }
);

export const TUNING_GROUPS: TuningGroup[] = [
  {
    // Nhóm KHÔNG có tham số nào - nội dung là form nhà cung cấp LLM do trình
    // duyệt gắn vào (`extra` của TuningDetailPanel), giống cách "Đổi mật khẩu"
    // đang nằm trong nhóm Chung.
    //
    // Cố ý KHÔNG biến 4 ô đó thành tham số ở đây: trang này tự lưu từng ô lúc
    // rời ô, mà lưu Base URL mới trong khi Model còn của nhà cũ là bot gọi sai
    // suốt quãng giữa. Form riêng có nút Lưu tường minh và nút Test kết nối.
    //
    // Đứng ĐẦU danh sách vì đây là việc phải làm đầu tiên khi cài mới - thiếu
    // nó thì bot không trả lời được tin nào.
    id: "providers",
    title: "Nhà cung cấp LLM",
    navHint: "API key, model, base URL",
    hint: "Nguồn cấu hình LLM chính cho mọi agent - áp dụng ngay, không cần khởi động lại bot.",
  },
  {
    id: "general",
    title: "Chung",
    navHint: "Múi giờ, mật khẩu, đặt lại",
    hint: "Múi giờ bot dùng để hiểu thời gian, mật khẩu đăng nhập dashboard và nút đặt lại toàn bộ cấu hình.",
  },
  {
    id: "turn",
    title: "Lượt trả lời",
    navHint: "Giới hạn số lượt trả lời",
    hint: "Bot được phép làm bao nhiêu, trong bao lâu, nghĩ kỹ tới đâu.",
  },
  {
    id: "context",
    title: "Ngữ cảnh & Trí nhớ",
    navHint: "Quản lý ngữ cảnh hội thoại",
    hint: "Bot nhớ lại bao nhiêu trước khi trả lời.",
  },
  {
    id: "web",
    title: "Tra cứu web",
    navHint: "Thiết lập tìm kiếm thông tin",
    hint: "Số nguồn và lượng chữ đọc từ mỗi trang.",
  },
  {
    id: "documents",
    title: "Tạo file Word/Excel",
    navHint: "Xuất dữ liệu & báo cáo",
    hint: "Trần kích thước file và số file mỗi giờ.",
  },
  {
    id: "images",
    title: "Vẽ ảnh",
    navHint: "Tạo và chỉnh sửa hình ảnh",
    hint: "Số ảnh mỗi giờ và thời gian chờ nhà cung cấp.",
  },
  {
    id: "sending",
    title: "Gửi tin trên Zalo",
    navHint: "Cấu hình gửi tin nhắn",
    hint: "Cách bot chia tin và giãn nhịp gửi cho tự nhiên.",
  },
  {
    id: "logs",
    title: "Trace và dọn dẹp",
    navHint: "Nhật ký & lưu trữ",
    hint: "Ghi lại bao nhiêu, giữ trong bao lâu.",
  },
  {
    id: "schedule",
    title: "Lịch hẹn",
    navHint: "Quản lý lịch hẹn",
    hint: "Bot tự nhắn theo lịch: tần suất quét, trần chống spam, giữ log bao lâu.",
  },
];

const TUNING_BY_KEY = {
  // --- Chung ---
  BOT_TIMEZONE: {
    kind: "timezone",
    group: "general",
    label: "Múi giờ của bot",
    hint: 'Bot sẽ hiểu "hôm nay", "3 giờ chiều" theo múi giờ bạn chọn. Sai múi giờ có thể dẫn đến nhắc lịch sai thời gian.',
  },

  // --- Lượt trả lời ---
  LLM_MAX_STEPS: {
    kind: "number",
    group: "turn",
    label: "Số bước tối đa mỗi lượt",
    hint: "Một bước là một lần bot nói chuyện với model, có thể gọi nhiều công cụ cùng lúc. Trò chuyện thường tốn 1 bước, tra cứu web 3-5 bước. Hết bước mà chưa xong thì bot chạy thêm một lượt chốt để trả lời bằng dữ liệu đã có.",
    min: 1,
    max: 30,
    unit: "bước",
  },
  LLM_MAX_OUTPUT_TOKENS: {
    kind: "number",
    group: "turn",
    label: "Trần token bot viết ra",
    hint: "Tính cho TỪNG bước, không phải cả lượt. Phải đủ chỗ cho bước tốn nhất là tạo file: bot viết cả nội dung file vào lệnh gọi công cụ. Hạ xuống dưới 12.000 thì phải hạ trần ký tự tài liệu theo.",
    min: 256,
    max: 200_000,
    unit: "token",
  },
  LLM_TURN_TIMEOUT_MS: {
    kind: "number",
    group: "turn",
    label: "Trần thời gian mỗi lượt",
    hint: "Bỏ cuộc khi cả lượt chạy quá lâu, tránh một cuộc trò chuyện bị treo cứng làm mọi tin nhắn sau phải xếp hàng. PHẢI lớn hơn thời gian chờ vẽ ảnh, vì lúc vẽ ảnh cũng tính vào lượt.",
    min: 60_000,
    max: 3_600_000,
    unit: "ms",
  },
  LLM_REASONING_EFFORT: {
    kind: "enum",
    group: "turn",
    label: "Mức suy nghĩ mặc định",
    hint: "Không bật thì bot lướt qua dữ liệu dài mà không nghĩ từng bước - đã gặp thật: dữ liệu đã có sẵn trong ngữ cảnh mà bot vẫn bảo chưa lấy được. Từng agent đặt riêng được, để trống là theo mức này.",
    options: ["off", "low", "medium", "high", "xhigh"],
  },
  TOOL_LOOP_SAME_ARGS_BLOCK: {
    kind: "number",
    group: "turn",
    label: "Chặn khi lặp y hệt",
    hint: "Bot gọi cùng một công cụ với cùng tham số và cùng bị lỗi bấy nhiêu lần thì dừng, không thử tiếp. Thử lại y hệt sau khi đã hỏng vài lần là vô vọng, chỉ tốn thêm bước và bắt người dùng đợi.",
    min: 2,
    max: 30,
    unit: "lần",
  },
  TOOL_LOOP_SAME_TOOL_BLOCK: {
    kind: "number",
    group: "turn",
    label: "Chặn khi một công cụ lỗi liên tục",
    hint: "Cùng một công cụ lỗi bấy nhiêu lần trong một lượt thì dừng, dù mỗi lần thử tham số khác nhau. Ngưỡng cao hơn mức trên vì đổi tham số còn có thể là đang dò tìm.",
    min: 2,
    max: 50,
    unit: "lần",
  },
  TOOL_LOOP_NO_PROGRESS_BLOCK: {
    kind: "number",
    group: "turn",
    label: "Chặn khi tra mãi ra cùng kết quả",
    hint: "Công cụ CHỈ ĐỌC (tìm kiếm, đọc trang) trả về đúng một kết quả bấy nhiêu lần thì dừng - gọi thêm không có gì mới. Không áp cho công cụ gửi hay sửa, vì gửi hai lần giống nhau là chuyện bình thường.",
    min: 2,
    max: 30,
    unit: "lần",
  },
  LLM_CACHE_SESSION_ENABLED: {
    kind: "boolean",
    group: "turn",
    label: "Bật prompt cache theo phiên",
    hint: "Gửi kèm mã phiên ổn định theo cuộc trò chuyện để router tái dùng phần đầu prompt, rẻ hơn nhiều. Chỉ tắt khi router đổi quy ước hoặc cần mỗi lượt hoàn toàn độc lập.",
  },
  MID_TURN_INJECTION_ENABLED: {
    kind: "boolean",
    group: "turn",
    label: "Nhận tin nhắn thêm giữa chừng",
    hint: "Bot đang làm dở mà bạn nhắn thêm thì nó đọc luôn và tính vào việc đang làm, thay vì làm xong theo yêu cầu cũ rồi mới đọc. Tắt đi thì tin nhắn thêm phải đợi hết lượt.",
  },
  BUSY_ACK_AFTER_MS: {
    kind: "number",
    group: "sending",
    label: "Nhắn trấn an khi bắt chờ quá lâu",
    hint: "Việc chạy lâu hơn ngần này mà có người nhắn thêm thì bot nói một câu cho biết vẫn đang làm. Mặc định 10 phút vì trước đó dấu 'đang nhập...' đã nói thay rồi. Đặt 0 để không bao giờ nhắn câu này.",
    min: 0,
    max: 3_600_000,
    unit: "ms",
  },

  // --- Ngữ cảnh và trí nhớ ---
  HISTORY_CONTEXT_LIMIT: {
    kind: "number",
    group: "context",
    label: "Số tin nhắn nạp lại",
    hint: "Bot đọc lại bấy nhiêu tin gần nhất mỗi lượt. Tăng thì bot nhớ dai hơn nhưng mỗi lượt tốn thêm token, và mỗi bước đều gửi lại toàn bộ.",
    min: 1,
    max: 200,
    unit: "tin",
  },
  LLM_CONTEXT_WINDOW: {
    kind: "number",
    group: "context",
    label: "Trần token mỗi lần gọi model",
    hint: "Khác với số tin nạp lại: một tin Zalo có thể rất dài, nên đếm tin không chặn được ngữ cảnh phình. Vượt mức này bot tự bỏ bớt ảnh cũ trước, rồi mới bỏ tin cũ - phần bỏ đi vẫn còn trong bản tóm tắt. Đặt theo cửa sổ của model đang chạy; agent dùng model khác đặt riêng được ở trang Agents.",
    min: 4_000,
    max: 2_000_000,
    unit: "token",
  },
  HISTORY_IMAGE_CONTEXT_LIMIT: {
    kind: "number",
    group: "context",
    label: "Số ảnh cũ kèm lại",
    hint: "Để bot xem lại được ảnh gửi vài phút trước. Ảnh rất tốn token nên đừng để cao.",
    min: 0,
    max: 20,
    unit: "ảnh",
  },
  SUMMARY_TRIGGER_MESSAGES: {
    kind: "number",
    group: "context",
    label: "Tóm tắt sau mỗi",
    hint: "Cứ bấy nhiêu tin thì bot tóm tắt lại đoạn đã trôi khỏi cửa sổ nhớ, để chuyện cũ không mất hẳn.",
    min: 5,
    max: 500,
    unit: "tin",
  },
  MEMORY_MAX_FACTS_PER_SUBJECT: {
    kind: "number",
    group: "context",
    label: "Số điều ghi nhớ mỗi người",
    hint: "Trần số mẩu thông tin bot tự lưu về một người.",
    min: 1,
    max: 1000,
    unit: "mục",
  },
  HISTORY_MAX_MESSAGES_PER_THREAD: {
    kind: "number",
    group: "context",
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
    hint: "Cắt bớt trang quá dài. Đặt thấp quá thì phần cần tìm nằm sau chỗ cắt - đã gặp thật: bảng dữ liệu cần đọc nằm sau ký tự thứ 8.300.",
    min: 2000,
    max: 100_000,
    unit: "ký tự",
  },

  // --- Tạo file ---
  DOCUMENT_MAX_PER_HOUR: {
    kind: "number",
    group: "documents",
    label: "Số file mỗi giờ",
    hint: "Chặn việc đốt token và gửi file dồn dập.",
    min: 1,
    max: 200,
    unit: "file",
  },
  DOCUMENT_MAX_BLOCKS: {
    kind: "number",
    group: "documents",
    label: "Số phần tối đa",
    hint: "Mỗi tiêu đề, đoạn văn hay bảng tính là một phần.",
    min: 1,
    max: 500,
    unit: "phần",
  },
  DOCUMENT_MAX_ROWS: {
    kind: "number",
    group: "documents",
    label: "Số dòng mỗi bảng",
    hint: "Trần cho một bảng trong Word hoặc một sheet Excel.",
    min: 1,
    max: 5000,
    unit: "dòng",
  },
  DOCUMENT_MAX_CHARS: {
    kind: "number",
    group: "documents",
    label: "Trần ký tự cả file",
    hint: "Phải nhỏ hơn trần token bot viết ra, nếu không bot bị cắt giữa chừng khi đang viết nội dung file và mất cả lượt.",
    min: 500,
    max: 500_000,
    unit: "ký tự",
  },
  DOCUMENT_MAX_SHEETS: {
    kind: "number",
    group: "documents",
    label: "Số sheet mỗi file Excel",
    hint: "",
    min: 1,
    max: 50,
    unit: "sheet",
  },

  // --- Vẽ ảnh ---
  IMAGE_GEN_MAX_PER_HOUR: {
    kind: "number",
    group: "images",
    label: "Số ảnh mỗi giờ",
    hint: "Vẽ ảnh tốn tiền và tốn thời gian, nên có trần theo giờ.",
    min: 1,
    max: 100,
    unit: "ảnh",
  },
  IMAGE_GEN_STALL_MS: {
    kind: "number",
    group: "images",
    label: "Bỏ cuộc khi im lặng quá",
    hint: "Đếm khoảng LẶNG giữa hai tín hiệu, không phải tổng thời gian. Nhà cung cấp còn gửi tín hiệu sống thì cứ chờ tiếp, dù ảnh khó vẽ mất vài phút.",
    min: 30_000,
    max: 300_000,
    unit: "ms",
  },
  IMAGE_GEN_TIMEOUT_MS: {
    kind: "number",
    group: "images",
    label: "Trần thời gian mỗi ảnh",
    hint: "Chặn trên cho cả lần vẽ. Phải nhỏ hơn trần thời gian mỗi lượt, nếu không lượt bị cắt trước khi ảnh kịp xong.",
    min: 30_000,
    max: 1_800_000,
    unit: "ms",
  },
  IMAGE_GEN_QUALITY: {
    kind: "enum",
    group: "images",
    label: "Mức chi tiết khi vẽ",
    hint: 'Đo A/B cùng prompt: "Cao" ra ảnh giàu chi tiết hơn hẳn mà không chậm hơn, đổi lại nhà cung cấp thường tính phí cao hơn. Hạ xuống "Vừa" nếu thấy tốn. Hai mức cuối là của dòng dall-e.',
    options: ["auto", "low", "medium", "high", "standard", "hd"],
  },

  // --- Gửi tin ---
  ZALO_IMAGE_QUALITY: {
    kind: "enum",
    group: "sending",
    label: "Cỡ ảnh tải về từ Zalo",
    hint: "Ảnh người dùng gửi được tải ở cỡ này để bot xem. Nét nhất thì đắt gấp mấy lần token, nhỏ nhất thì rẻ nhưng hay mất chữ số trên giấy tờ.",
    options: ["thumb", "normal", "hd"],
  },
  ZALO_RICH_TEXT_ENABLED: {
    kind: "boolean",
    group: "sending",
    label: "Định dạng chữ trên Zalo",
    hint: "Dịch in đậm, tiêu đề, danh sách của model thành định dạng thật của Zalo thay vì xóa đi. Tắt thì quay lại chữ phẳng.",
  },
  ZALO_RICH_TEXT_MAX_PAYLOAD_BYTES: {
    kind: "number",
    group: "sending",
    label: "Trần byte tin có định dạng",
    hint: "Zalo từ chối tin khi chữ + định dạng cộng lại quá lớn. Đo thật: 3281 byte gửi được, 3712 byte bị chối. Vượt trần thì tin tự cắt nhỏ hơn.",
    min: 1000,
    max: 3600,
    unit: "byte",
  },
  ZALO_MAX_MESSAGE_CHARS: {
    kind: "number",
    group: "sending",
    label: "Ký tự mỗi tin",
    hint: "Zalo chặn tin quá dài nên câu trả lời dài bị chia nhỏ.",
    min: 500,
    max: 4000,
    unit: "ký tự",
  },
  ZALO_MAX_MESSAGE_PARTS: {
    kind: "number",
    group: "sending",
    label: "Số đoạn tối đa",
    hint: "Câu trả lời dài hơn mức này thì phần dư bị bỏ, tránh bot xả một tràng chục tin liên tiếp.",
    min: 1,
    max: 20,
    unit: "đoạn",
  },
  MESSAGE_BATCH_DEBOUNCE_MS: {
    kind: "number",
    group: "sending",
    label: "Chờ gộp tin",
    hint: "Người ta hay gửi ảnh rồi mới gõ chú thích. Chờ một nhịp rồi mới xử lý thì bot hiểu trọn ý thay vì trả lời hai lần.",
    min: 0,
    max: 15_000,
    unit: "ms",
  },
  SEND_DELAY_MIN_MS: {
    kind: "number",
    group: "sending",
    label: "Giãn nhịp gửi tối thiểu",
    hint: "Trả lời tức thì mọi lúc trông rất máy móc. Chờ ngẫu nhiên trong khoảng này trước khi gửi.",
    min: 0,
    max: 60_000,
    unit: "ms",
  },
  SEND_DELAY_MAX_MS: {
    kind: "number",
    group: "sending",
    label: "Giãn nhịp gửi tối đa",
    hint: "Phải lớn hơn hoặc bằng mức tối thiểu.",
    min: 0,
    max: 60_000,
    unit: "ms",
  },
  TYPING_REFRESH_MS: {
    kind: "number",
    group: "sending",
    label: "Nhịp báo đang nhập",
    hint: "Zalo không có lệnh tắt chỉ báo nên phải bắn lại theo chu kỳ để giữ chữ đang nhập.",
    min: 1000,
    max: 10_000,
    unit: "ms",
  },

  // --- Trace và dọn dẹp ---
  AGENT_TRACE_ENABLED: {
    kind: "boolean",
    group: "logs",
    label: "Ghi trace từng bước",
    hint: "Lưu lại bot đã nghĩ gì, gọi công cụ nào với tham số gì. Tắt thì trang Trace không có dữ liệu mới.",
  },
  AGENT_TRACE_MAX_CHARS: {
    kind: "number",
    group: "logs",
    label: "Trần chữ mỗi khối trace",
    hint: "Cắt bớt nội dung dài trong trace, có ghi kèm độ dài thật để biết mình đang mất bao nhiêu.",
    min: 50,
    max: 20_000,
    unit: "ký tự",
  },
  AGENT_TRACE_RETENTION_DAYS: {
    kind: "number",
    group: "logs",
    label: "Giữ trace",
    hint: "Bảng trace phình nhanh nhất trong cơ sở dữ liệu nên có dọn tự động.",
    min: 1,
    max: 365,
    unit: "ngày",
  },
  MEDIA_RETENTION_DAYS: {
    kind: "number",
    group: "logs",
    label: "Giữ ảnh đã tải",
    hint: "Ảnh người dùng gửi được lưu lại để bot xem lại ở lượt sau, quá hạn thì xóa cho nhẹ đĩa.",
    min: 1,
    max: 365,
    unit: "ngày",
  },

  // --- Lịch hẹn ---
  SCHEDULER_ENABLED: {
    kind: "boolean",
    group: "schedule",
    label: "Bật lịch hẹn",
    hint: "Tắt thì vòng quét job đến hạn dừng hẳn - job vẫn còn nguyên trong DB, chỉ đơn giản không job nào được gửi. Bật lại là chạy tiếp, không mất job.",
  },
  SCHEDULER_TICK_MS: {
    kind: "number",
    group: "schedule",
    label: "Chu kỳ quét job đến hạn",
    hint: "Bảng job rất nhỏ nên quét dày không tốn gì đáng kể, chỉ ảnh hưởng độ trễ tối đa trước khi một job đến hạn được nhặt lên.",
    min: 5000,
    max: 300_000,
    unit: "ms",
  },
  SCHEDULER_MIN_INTERVAL_MINUTES: {
    kind: "number",
    group: "schedule",
    label: "Khoảng lặp tối thiểu",
    hint: "Chặn lịch every/cron dày hơn mức này NGAY LÚC TẠO job - lưới đỡ đầu chống bot nhắn quá dày. every 1 phút là 1440 tin/ngày vào một nick cá nhân, đúng chữ ký để Zalo khoá nick.",
    min: 1,
    max: 1440,
    unit: "phút",
  },
  SCHEDULER_MAX_JOBS_PER_THREAD: {
    kind: "number",
    group: "schedule",
    label: "Số job tối đa mỗi cuộc trò chuyện",
    hint: "Trần số job ĐANG BẬT trong 1 thread, chặn một cuộc trò chuyện tạo vô số lời nhắc.",
    min: 1,
    max: 200,
    unit: "job",
  },
  SCHEDULER_MAX_PROACTIVE_PER_DAY: {
    kind: "number",
    group: "schedule",
    label: "Trần tin chủ động mỗi ngày",
    hint: "Chỉ đếm tin do scheduler TỰ BẮN (không phải trả lời tin tới), theo ngày múi giờ của bot. Lưới đỡ cuối, độc lập với khoảng lặp tối thiểu ở trên.",
    min: 1,
    max: 100,
    unit: "tin",
  },
  SCHEDULER_SEND_GAP_MS: {
    kind: "number",
    group: "schedule",
    label: "Giãn cách gửi chủ động",
    hint: "Hàng đợi TOÀN CỤC cho mọi tin chủ động (khác hàng đợi trong 1 thread đang có sẵn) - 2 job ở 2 thread khác nhau tới hạn cùng lúc vẫn cách nhau chừng này.",
    min: 0,
    max: 300_000,
    unit: "ms",
  },
  SCHEDULER_ONCE_GRACE_MINUTES: {
    kind: "number",
    group: "schedule",
    label: "Grace cho lịch một lần",
    hint: "Job 'nhắc 1 lần' trễ trong khoảng này vẫn gửi như bình thường. Trễ hơn vẫn gửi (không im lặng bỏ qua một lời đã hẹn) nhưng kèm nhãn báo trễ.",
    min: 1,
    max: 1440,
    unit: "phút",
  },
  SCHEDULER_DEFERRED_RUN_HOUR: {
    kind: "number",
    group: "schedule",
    label: "Giờ chạy lại sau khi hoãn vì trần",
    hint: "Job 'nhắc 1 lần' bị trần ngày chặn thì đẩy sang giờ này của ngày mai, không phải 00:00 - tránh dồn cả loạt job hoãn thành 1 chùm tin đúng lúc trần vừa reset.",
    min: 0,
    max: 23,
    unit: "giờ",
  },
  SCHEDULER_RUN_LOG_KEEP: {
    kind: "number",
    group: "schedule",
    label: "Số lượt chạy giữ lại mỗi job",
    hint: "Lịch sử chạy (thành công/lỗi/bỏ qua) của từng job, cũ hơn mức này bị dọn tự động.",
    min: 5,
    max: 1000,
    unit: "lượt",
  },
} as const satisfies Record<string, TuningDef>;

export const TUNING_DEFS: Record<string, TuningDef> = TUNING_BY_KEY;

/** Kiểm tra lúc biên dịch: mọi key phải là biến môi trường có thật */
type _KhopVoiEnv = TuningKey extends keyof typeof env ? true : never;
const _kiemTra: _KhopVoiEnv = true;
void _kiemTra;
