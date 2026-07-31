import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isValidTimezone } from "../shared/current-datetime.js";

// Nạp .env bằng API built-in của Node (>= 20.12); thiếu file thì lấy env từ OS
try {
  process.loadEnvFile();
} catch {
  /* không có .env - dùng biến môi trường hệ thống */
}

/**
 * "KEY=" trong .env cho ra chuỗi rỗng, không phải undefined - mà `.env.example`
 * ship đúng dạng đó cho các biến tùy chọn. Không quy về undefined thì copy
 * example nguyên bản là crash lúc boot ("DASHBOARD_PASSWORD: tối thiểu 8 ký tự")
 * dù ý nghĩa mong muốn là "không set = tắt dashboard".
 */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  DATA_DIR: z.string().default("./data"),

  LLM_PROVIDER: z.enum(["openai-compatible", "anthropic"]).default("openai-compatible"),
  LLM_BASE_URL: z.preprocess(emptyToUndefined, z.string().startsWith("http").optional()),
  // Để trống được: key có thể nhập ở trang Providers trên dashboard (lưu DB, mã
  // hóa). Thiếu cả 2 nơi thì lượt agent lỗi với thông báo rõ, không chết lúc boot.
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().min(1),
  LLM_MAX_STEPS: z.coerce.number().int().min(1).max(30).default(8),
  // Trần thời gian cho CẢ lượt agent. Không có nó thì chặn trên duy nhất là mặc
  // định của undici (300s chờ header) nhân maxRetries nhân số step - router nhận
  // kết nối rồi treo là khóa luôn thread đó hàng giờ, và mọi tin nhắn sau phải
  // xếp hàng chờ. RÀNG BUỘC: phải LỚN HƠN IMAGE_GEN_TIMEOUT_MS (mặc định 600s),
  // vì thời gian chạy tool nằm trong lượt; đặt thấp hơn là giết ngang lượt vẽ
  // ảnh hợp lệ. Đo thật: lượt nặng nhất quan sát được là 236s (tạo file Word).
  LLM_TURN_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  // Trần token model được sinh ra mỗi lượt. Phải đủ chỗ cho lượt TỐN NHẤT là
  // gọi tool tạo file: model viết cả nội dung file vào tool call. Đo thật một
  // báo cáo 6 sheet (15.000 ký tự nội dung) tốn ~7.100 token payload; cộng
  // reasoning (LLM_REASONING_EFFORT) và câu trả lời -> 16.384 là vừa đủ có biên.
  // RÀNG BUỘC: hạ số này xuống dưới ~12.000 thì DOCUMENT_MAX_CHARS phải hạ theo,
  // nếu không model bị cắt giữa tool call (finishReason "length") và mất cả lượt.
  // Đây là TRẦN, không phải mục tiêu - trả lời chat thường vẫn vài trăm token.
  // Model đang dùng đỡ được thoải mái: gpt-5.6-sol 128.000, deepseek-v4-pro 50.000.
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(16_384),
  // Mức "suy nghĩ" (reasoning/thinking) của model - học Hermes: không bật thì
  // model lướt 50k token nội dung trang trong 1 lượt đọc, việc cần nghĩ từng
  // bước (đối chiếu số vé, đọc bảng) sẽ ẩu. off = tắt hẳn.
  LLM_REASONING_EFFORT: z.enum(["off", "low", "medium", "high", "xhigh"]).default("medium"),
  // Gửi header x-session-id ổn định theo thread để router bật prompt caching.
  // Không gửi thì 9Router rơi về fallback băm text assistant - text đó dài thêm
  // mỗi lượt nên khóa đổi liên tục và cache không bao giờ trúng. Tắt khi router
  // đổi quy ước header hoặc cần cô lập từng request.
  LLM_CACHE_SESSION_ENABLED: z.preprocess(emptyToUndefined, z.stringbool().default(true)),

  // Múi giờ của bot: bơm ngày vào system prompt + tool get_datetime.
  // Kiểm IANA hợp lệ ngay lúc boot thay vì để lượt agent đầu tiên mới lộ.
  BOT_TIMEZONE: z
    .string()
    .default("Asia/Ho_Chi_Minh")
    .refine(isValidTimezone, "phải là tên timezone IANA, vd Asia/Ho_Chi_Minh"),
  // Key Brave dự phòng cho web search. Nên nhập ở trang Tools trên dashboard
  // (lưu DB, mã hóa) - env chỉ dùng khi DB chưa có. DuckDuckGo luôn là lưới
  // đỡ cuối nên thiếu key vẫn tìm được.
  BRAVE_SEARCH_API_KEY: z.string().default(""),
  // Số kết quả web search tối đa trả cho agent mỗi lần tìm
  WEB_SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
  // Số ký tự tối đa web_fetch trả cho model. Từng để 8000 và dính lỗi thật:
  // trang xổ số phần đầu toàn menu, bảng kết quả nằm sau ký tự 8300 -> bị cắt
  // mất, bot tưởng trang không có dữ liệu. GoClaw để 60000; mình để 15000 vì
  // mỗi ký tự là token trả tiền, kèm lọc menu trong html-to-text để nội dung
  // thật không bị rác đẩy ra khỏi cap.
  WEB_FETCH_MAX_CHARS: z.coerce.number().int().min(2000).max(100_000).default(15_000),
  // Fetch tự làm hỏng hoặc ra quá ít chữ (trang render bằng JavaScript, chặn
  // bot) thì đẩy URL qua Jina Reader - đo thực tế cứu được giavang.doji.vn và
  // vnexpress. Đánh đổi: chậm hơn nhiều và URL đi qua bên thứ ba, tắt được ở đây.
  WEB_FETCH_FALLBACK_ENABLED: z.preprocess(emptyToUndefined, z.stringbool().default(true)),

  // Model chính có đọc được ảnh không. auto = tự hỏi router qua GET {baseUrl}/models
  // (9Router trả capabilities.vision cho từng model; endpoint khác không có field
  // này thì coi như đọc được - giữ hành vi cũ). on/off = ép tay, dùng khi endpoint
  // không phải 9Router mà model thật sự không có vision.
  LLM_VISION_MODE: z.enum(["auto", "on", "off"]).default("auto"),
  // Model phụ "đọc ảnh thuê" khi model chính không có vision: mô tả ảnh thành text
  // 1 lần (cache trong DB), model chính đọc text. Gemini free tier qua endpoint
  // OpenAI-compatible là lựa chọn tiêu chuẩn (GoClaw cũng dùng gemini làm mắt).
  // Cấu hình được từ dashboard (trang Providers) - env chỉ là giá trị khởi điểm.
  VISION_SIDECAR_BASE_URL: z.preprocess(emptyToUndefined, z.string().startsWith("http").optional()),
  VISION_SIDECAR_MODEL: z.string().default(""),
  VISION_SIDECAR_API_KEY: z.string().default(""),

  HISTORY_CONTEXT_LIMIT: z.coerce.number().int().min(1).max(200).default(20),
  // Ảnh cũ trong history được nạp lại vào context để model "nhớ" ảnh đã nhận.
  // MỖI ảnh tốn ~1500-2500 token và bị gửi lại ở MỌI step của lượt agent, nên
  // để 3 là đắt gấp 3 lần cần thiết cho nhu cầu thường gặp (hỏi lại về ảnh
  // vừa gửi). Mặc định 1; 0 = tắt hẳn.
  HISTORY_IMAGE_CONTEXT_LIMIT: z.coerce.number().int().min(0).max(20).default(1),
  // Cỡ ảnh lấy từ payload Zalo: normal (mặc định, đủ đọc chữ số, rẻ),
  // hd (nét nhất, đắt gấp mấy lần), thumb (rẻ nhất nhưng hay mất chữ số).
  ZALO_IMAGE_QUALITY: z.enum(["thumb", "normal", "hd"]).default("normal"),
  // Ảnh nhận được lưu vào data/media để xem lại; file cũ hơn N ngày bị xóa
  // (dọn lúc khởi động + mỗi 24h) để đĩa không phình vô hạn.
  MEDIA_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  // Giới hạn tool tạo file .docx/.xlsx. Bot đọc tin người lạ nên phải chặn
  // trước: nội dung khổng lồ vừa tốn CPU/đĩa vừa ra file không ai đọc nổi.
  DOCUMENT_MAX_BLOCKS: z.coerce.number().int().min(1).max(500).default(60),
  DOCUMENT_MAX_ROWS: z.coerce.number().int().min(1).max(5000).default(200),
  DOCUMENT_MAX_CHARS: z.coerce.number().int().min(500).max(500_000).default(20_000),
  // Báo cáo tử tế hay có 5-7 sheet (tổng quan, chi tiết, số liệu, rủi ro,
  // nguồn) - trần 5 chặn oan nên để 10
  DOCUMENT_MAX_SHEETS: z.coerce.number().int().min(1).max(50).default(10),
  // Số file tối đa 1 thread được tạo trong 1 giờ - chặn spam "xuất file" liên tục
  DOCUMENT_MAX_PER_HOUR: z.coerce.number().int().min(1).max(200).default(10),

  // Tool vẽ ảnh. Endpoint OpenAI-compatible /v1/images/generations (9Router,
  // OpenAI, hoặc gateway bất kỳ nói cùng giao thức). Cấu hình được từ dashboard
  // (Settings của dòng tool trên trang Tools) - env chỉ là giá trị khởi điểm.
  // KHÔNG tự dò được model như sidecar: /v1/models chỉ liệt kê model chat.
  IMAGE_GEN_BASE_URL: z.preprocess(emptyToUndefined, z.string().startsWith("http").optional()),
  IMAGE_GEN_MODEL: z.string().default(""),
  IMAGE_GEN_API_KEY: z.string().default(""),
  // Vẽ 1 ảnh mất ~70 giây (đo trên cx/gpt-5.5-image) và TỐN TIỀN THẬT mỗi lần.
  // Bot đọc tin người lạ nên trần này là hàng phòng thủ chính chống đốt quota.
  IMAGE_GEN_MAX_PER_HOUR: z.coerce.number().int().min(1).max(100).default(10),
  // Ghi log ra file JSON xoay vòng trong data/logs. Không bật thì log chỉ tồn
  // tại trong terminal đang chạy bot - đóng terminal là mất sạch, và trên VPS
  // thì không có gì để lần lại khi có sự cố.
  LOG_FILE_ENABLED: z.preprocess(emptyToUndefined, z.stringbool().default(true)),
  // Giữ lại bao nhiêu file (xoay vòng mỗi ngày 1 file). File ghi MỌI mức kể cả
  // debug, độc lập với LOG_LEVEL của terminal - terminal cần gọn, file cần đủ.
  LOG_FILE_KEEP_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  // Trace từng step của lượt agent (model nói gì, gọi tool nào với tham số gì,
  // provider cảnh báo gì). Tắt thì bot vẫn chạy, chỉ mất đường chẩn đoán.
  AGENT_TRACE_ENABLED: z.preprocess(emptyToUndefined, z.stringbool().default(true)),
  // Trần ký tự mỗi mẩu nội dung trong trace. Trace chứa NGUYÊN VĂN tin nhắn của
  // người thật nên cắt ngắn vừa đỡ phình DB vừa đỡ lưu dư thông tin cá nhân.
  // Phần bị cắt vẫn ghi kèm độ dài thật để biết mình đang mất bao nhiêu.
  AGENT_TRACE_MAX_CHARS: z.coerce.number().int().min(50).max(20_000).default(500),
  // Bảng agent_steps phình nhanh nhất trong DB (mỗi lượt vài step, mỗi step vài
  // mẩu nội dung), nên dọn cùng nhịp với media.
  AGENT_TRACE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),

  // Mức chi tiết khi vẽ. Đo A/B cùng prompt: "high" ra ảnh giàu chi tiết hơn
  // hẳn (khối phát sáng, lớp sóng hạt, nhiều tầng biểu đồ) mà KHÔNG chậm hơn
  // (50s so với 60s). Đổi lại nhà cung cấp thường tính phí cao hơn mức mặc
  // định - hạ xuống "medium" nếu thấy tốn. "standard"/"hd" là của dòng dall-e.
  IMAGE_GEN_QUALITY: z.enum(["auto", "low", "medium", "high", "standard", "hd"]).default("high"),
  // Phép đo ĐÚNG cho stream: im lặng bao lâu thì coi là kết nối chết. Đo thật
  // trên prompt nặng (tổng 135 giây): provider bắn keepalive đều mỗi 30 giây,
  // khoảng im lặng dài nhất 30.1 giây. 90s = gấp 3 lần nhịp đó. Vẽ lâu mà stream
  // còn chảy là KHỎE, im lặng lâu mới là CHẾT - trần tổng không phân biệt được.
  IMAGE_GEN_STALL_MS: z.coerce.number().int().min(30_000).max(300_000).default(90_000),
  // Chốt chặn cuối cho cả lượt vẽ. KHÔNG phải để cắt lượt vẽ chậm (trần im lặng
  // lo việc đó) mà chỉ chặn ca bệnh lý: provider bắn keepalive mãi không vẽ
  // xong. Để rộng vì prompt phức tạp đo được 135 giây, và trên web có ca 3-4 phút.
  IMAGE_GEN_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(1_800_000).default(600_000),

  // Memory lớp 2: đủ N tin rớt khỏi cửa sổ replay thì gộp vào summary của thread
  SUMMARY_TRIGGER_MESSAGES: z.coerce.number().int().min(5).max(500).default(30),
  // Memory lớp 3: tối đa bao nhiêu fact được lưu cho mỗi người/nhóm
  MEMORY_MAX_FACTS_PER_SUBJECT: z.coerce.number().int().min(1).max(1000).default(50),
  // Số tin tối đa giữ lại mỗi thread; tin cũ hơn bị xóa sau mỗi lần ghi để DB
  // không phình vô hạn khi bot chạy dài ngày.
  HISTORY_MAX_MESSAGES_PER_THREAD: z.coerce.number().int().min(20).max(100_000).default(500),
  SEND_DELAY_MIN_MS: z.coerce.number().int().min(0).default(800),
  SEND_DELAY_MAX_MS: z.coerce.number().int().min(0).default(2500),
  // Zalo chặn tin quá dài ở phía server (error_code 118 "Nội dung quá dài") -
  // zca-js không kiểm gì nên vượt ngưỡng là mất trắng cả câu trả lời. Đo được:
  // chính Zalo tự cắt tin dán vào thành đoạn 2613 ký tự, tức trần thật >= 2613;
  // repo tham khảo zalo-personal chốt 4000 làm trần cứng và 2000 mỗi đoạn gửi.
  // Để 2000 cho có biên (phòng khi Zalo tính theo BYTE - tiếng Việt 1 ký tự
  // ~1.4 byte). Nâng lên thì ít tin hơn nhưng gần ngưỡng vỡ hơn.
  ZALO_MAX_MESSAGE_CHARS: z.coerce.number().int().min(500).max(4000).default(2000),
  // Trần số tin cho 1 lượt trả lời. Bắn quá nhiều tin liên tiếp là hành vi dễ
  // bị Zalo đánh dấu spam; vượt trần thì đoạn cuối kèm ghi chú "phần sau còn dài".
  ZALO_MAX_MESSAGE_PARTS: z.coerce.number().int().min(1).max(20).default(5),
  // Thời gian chờ gộp tin nhắn cùng thread thành 1 lượt agent (ảnh + caption,
  // hoặc user nhắn liền nhiều tin ngắn). Cao hơn = gộp tốt hơn nhưng trả lời chậm hơn.
  MESSAGE_BATCH_DEBOUNCE_MS: z.coerce.number().int().min(0).max(15000).default(2500),
  // Zalo không có API tắt "đang nhập", chỉ báo tự hết sau vài giây -> phải bắn
  // lặp lại theo chu kỳ này cho tới khi gửi xong câu trả lời
  TYPING_REFRESH_MS: z.coerce.number().int().min(1000).max(10000).default(3000),

  // ===== Lịch hẹn (scheduler): bot tự nhắn theo lịch =====
  // Tắt thì vòng tick không chạy - job vẫn nằm nguyên trong DB, chỉ đơn giản
  // không job nào được gửi. Bật lại chạy tiếp ngay, không mất job.
  SCHEDULER_ENABLED: z.preprocess(emptyToUndefined, z.stringbool().default(true)),
  // Chu kỳ quét job đến hạn. Bảng scheduled_jobs rất nhỏ (mỗi thread bị chặn ở
  // SCHEDULER_MAX_JOBS_PER_THREAD) nên 30s quét 1 lần dư sức, không cần thấp hơn.
  SCHEDULER_TICK_MS: z.coerce.number().int().min(5000).max(300_000).default(30_000),
  // Chặn `every`/`cron` dày hơn mức này NGAY LÚC TẠO job - lưới đỡ ĐẦU chống
  // spam. `every 1m` = 1440 tin/ngày vào một nick cá nhân, đúng chữ ký khoá nick.
  SCHEDULER_MIN_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  // Trần số job ĐANG BẬT mỗi cuộc trò chuyện - chặn 1 thread tạo vô số lời nhắc.
  SCHEDULER_MAX_JOBS_PER_THREAD: z.coerce.number().int().min(1).max(200).default(20),
  // Trần tin CHỦ ĐỘNG (do scheduler tự bắn, không phải trả lời tin tới) mỗi
  // thread mỗi ngày - đếm theo ngày BOT_TIMEZONE. Lưới đỡ CUỐI, độc lập với
  // chặn lúc tạo job ở trên.
  SCHEDULER_MAX_PROACTIVE_PER_DAY: z.coerce.number().int().min(1).max(100).default(10),
  // Rải đều tin chủ động: hàng đợi TOÀN CỤC (khác rate-limiter hiện có vốn chỉ
  // xếp hàng trong 1 thread), cách nhau chừng này giữa 2 tin chủ động bất kỳ thread nào.
  SCHEDULER_SEND_GAP_MS: z.coerce.number().int().min(0).max(300_000).default(20_000),
  // Job `once` trễ trong khoảng này vẫn gửi bình thường; trễ hơn VẪN GỬI (không
  // nuốt im lặng một lời NHẮC HẸN) nhưng kèm nhãn "nhắc trễ, lịch gốc ...".
  SCHEDULER_ONCE_GRACE_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  // Job `once` bị TRẦN NGÀY chặn thì đẩy sang giờ này của NGÀY MAI (không phải
  // 00:00 - dồn về đúng nửa đêm làm mất nhãn "nhắc trễ" + dồn cả loạt job hoãn
  // thành 1 chùm tin lúc trần vừa reset).
  SCHEDULER_DEFERRED_RUN_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  // Giữ tối đa bấy nhiêu lượt chạy gần nhất mỗi job trong scheduled_job_runs;
  // cũ hơn bị dọn ngay sau khi ghi lượt mới (cùng pattern prune của history-store).
  SCHEDULER_RUN_LOG_KEEP: z.coerce.number().int().min(5).max(1000).default(50),

  // Dashboard web (Hono, cùng process). Không set DASHBOARD_PASSWORD = dashboard tắt.
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3900),
  DASHBOARD_PASSWORD: z.preprocess(
    emptyToUndefined,
    z.string().min(8, "tối thiểu 8 ký tự").optional(),
  ),
  // Dashboard chạy sau reverse proxy HTTPS (Caddy/Nginx). Bật thì tin
  // X-Forwarded-For do proxy ghi (để rate-limit login đúng IP client) và gắn cờ
  // Secure vào cookie session. PHẢI để false khi truy cập trực tiếp qua http,
  // nếu không cookie không bao giờ được gửi và không đăng nhập được.
  DASHBOARD_BEHIND_PROXY: z.preprocess(emptyToUndefined, z.stringbool().default(false)),

  // Khóa AES-256 mã hóa cookie Zalo trên đĩa
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'phải là 64 ký tự hex - tạo bằng: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    ),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Cấu hình env không hợp lệ:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

if (env.LLM_PROVIDER === "openai-compatible" && !env.LLM_BASE_URL) {
  console.error("LLM_BASE_URL là bắt buộc khi LLM_PROVIDER=openai-compatible");
  process.exit(1);
}

if (env.SEND_DELAY_MAX_MS < env.SEND_DELAY_MIN_MS) {
  console.error("SEND_DELAY_MAX_MS phải >= SEND_DELAY_MIN_MS");
  process.exit(1);
}

// Giữ ít hơn số tin agent đọc mỗi lượt = vừa ghi xong đã bị xóa mất context
if (env.HISTORY_MAX_MESSAGES_PER_THREAD < env.HISTORY_CONTEXT_LIMIT) {
  console.error("HISTORY_MAX_MESSAGES_PER_THREAD phải >= HISTORY_CONTEXT_LIMIT");
  process.exit(1);
}

export const dataDir = path.resolve(env.DATA_DIR);
fs.mkdirSync(dataDir, { recursive: true });
