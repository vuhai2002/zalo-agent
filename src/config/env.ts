import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LLM_PROVIDER_KINDS } from "./llm-provider-kind.js";
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

  LLM_PROVIDER: z.enum(LLM_PROVIDER_KINDS).default("openai-compatible"),
  LLM_BASE_URL: z.preprocess(emptyToUndefined, z.string().startsWith("http").optional()),
  // Để trống được: key và tên model đều nhập được ở trang Providers trên
  // dashboard (lưu DB, key thì mã hóa). Thiếu cả 2 nơi thì lượt agent lỗi với
  // thông báo rõ, KHÔNG chết lúc boot - phải vào được dashboard mới nhập được,
  // mà chết lúc boot thì không có dashboard nào để vào.
  LLM_API_KEY: z.string().default(""),
  // Trước đây là `.min(1)`, tức BẮT BUỘC. Nhưng model là thứ người ta đổi
  // thường xuyên nhất trên dashboard, nên bắt buộc trong env vừa thừa vừa gây
  // hiểu nhầm: giá trị cũ nằm lại trong `.env` mà DB đang gánh, người đọc file
  // tưởng đó là model đang chạy. Cùng nếp với LLM_API_KEY.
  LLM_MODEL: z.string().default(""),
  // Mặc định 10 (trước là 8). Đo trên Gemini 06/08/2026 với yêu cầu "tóm tắt 10
  // tin": model tiêu 6-8 bước chỉ để TÌM rồi hết bước, chưa kịp mở bài nào bằng
  // web_fetch, nên câu trả lời toàn ý chung chung không số liệu. 10 để một lượt
  // nghiên cứu còn chỗ vừa tìm vừa đọc. Không nới hơn: mỗi bước là một lần gọi
  // model, mà trần token ngữ cảnh và trần thời gian lượt vẫn phải gánh phần sau.
  LLM_MAX_STEPS: z.coerce.number().int().min(1).max(30).default(10),
  // Trần token cho phần INPUT của một lần gọi model. Trước khi có nó, ngữ cảnh
  // chỉ bị chặn bằng SỐ TIN (HISTORY_CONTEXT_LIMIT) - mà một tin Zalo dài tùy
  // ý, nên đó là đếm nhầm đơn vị. Đo trên DB thật: đã có lượt cộng dồn 184.835
  // token qua 8 step. Mặc định 128k là CẬN DƯỚI AN TOÀN chạy được với mọi
  // model, không phải cửa sổ của model tuyến đầu (Opus 5 / Sonnet 5 /
  // Gemini 3.1 Pro đã 1M, GPT-5.6 1,05M). Cố ý để thấp: đặt cao hơn cửa sổ
  // THẬT của model đang chạy thì bot tưởng còn chỗ nên không cắt, provider trả
  // 400 - hỏng câm. Bot đi qua router nên model thật đổi bằng env, có thể là
  // model cửa sổ nhỏ. Nâng theo từng agent ở trang Agents, hoặc chọn mốc sẵn
  // trên trang Cấu hình (`context-window-presets.ts`).
  LLM_CONTEXT_WINDOW: z.coerce.number().int().min(4_000).max(2_000_000).default(128_000),
  // Chặn vòng lặp tool. Trước khi có ba biến này, chặn trên duy nhất là
  // LLM_MAX_STEPS: model gọi cùng một tool lỗi 5 lần liên tiếp thì đốt nửa số
  // bước mà không ai chặn. Số mặc định lấy đúng của `tool_guardrails.py`
  // (Hermes), vốn đã chạy thật ở đó. Ngưỡng CẢNH BÁO suy ra bằng nửa ngưỡng
  // chặn nên không thêm ba biến nữa.
  //
  // RÀNG BUỘC CHÉO với LLM_MAX_STEPS: ngưỡng cao BẰNG trần step là ngưỡng không
  // bao giờ tới lượt (mỗi step một lệnh gọi thì stepCountIs dừng trước). Ở Hermes
  // ba số này sống chung với max_iterations=90 nên 8 chỉ là 9% ngân sách. Từ khi
  // trần mặc định lên 10 thì SAME_TOOL_BLOCK=8 đã nằm dưới trần và tự nổ được;
  // phép kẹp trong `nguongTheoTranStep` vẫn giữ, vì trần đặt tay xuống thấp
  // (agent chạy model rẻ) lại đưa ngưỡng ra ngoài tầm với ngay.
  TOOL_LOOP_SAME_ARGS_BLOCK: z.coerce.number().int().min(2).max(30).default(5),
  TOOL_LOOP_SAME_TOOL_BLOCK: z.coerce.number().int().min(2).max(50).default(8),
  TOOL_LOOP_NO_PROGRESS_BLOCK: z.coerce.number().int().min(2).max(30).default(5),
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

  // Lượt đang chạy tự kéo tin người dùng vừa nhắn thêm vào giữa chừng, ở ranh
  // giới step. Không có nó thì lượt đầu vẫn chạy trọn theo bối cảnh thiếu rồi
  // tin nhắn thêm mới được xử lý ở lượt sau - xem mid-turn-injection.ts.
  MID_TURN_INJECTION_ENABLED: z.preprocess(emptyToUndefined, z.stringbool().default(true)),

  // Nhắn một câu trấn an khi người ta gửi tin lúc bot đã bận LÂU hơn ngần này.
  // Mặc định 10 phút = đúng lúc "đang nhập..." tự tắt (typing-indicator.ts):
  // trước mốc đó người nhắn đã có ba tín hiệu (đang nhập, đã xem, reaction) nên
  // thêm một tin text chỉ là nhiễu, và tốn thêm một lượt gọi API không chính
  // thức. Sau mốc đó thì im lặng hoàn toàn - đã xảy ra thật ngày 2026-08-04.
  // Đặt 0 để tắt hẳn.
  BUSY_ACK_AFTER_MS: z.coerce.number().int().min(0).max(3_600_000).default(600_000),

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

  // --- Tải video TikTok / Facebook ---
  //
  // Trần THỜI LƯỢNG chặn được TRƯỚC khi tải một byte nào: cả hai nguồn đều trả
  // `duration` ở bước metadata, tốn đúng một request. Đó là lý do chặn theo
  // thời lượng chứ không chỉ theo dung lượng.
  VIDEO_MAX_DURATION_MINUTES: z.coerce.number().int().min(1).max(300).default(30),
  // Lưới đỡ thứ hai: video ngắn mà bitrate cao vẫn nặng. Nguồn không phải lúc
  // nào cũng trả kích thước, nên trần này chỉ chặn được khi biết - không thay
  // thế được trần thời lượng.
  VIDEO_MAX_SIZE_MB: z.coerce.number().int().min(1).max(2000).default(100),
  // Trần mỗi THREAD mỗi giờ. Rủi ro lớn nhất của tính năng này là mất nick Zalo
  // vì gửi video ồ ạt, không phải VPS quá tải.
  VIDEO_MAX_PER_HOUR: z.coerce.number().int().min(1).max(200).default(15),
  // Số tiến trình tải chạy CÙNG LÚC. Đo thật: mỗi tiến trình yt-dlp ăn ~75 MB
  // RAM bất kể cỡ video, CỘNG cỡ video vì byte nằm trong RAM chứ không ghi đĩa
  // (V3.22). Mặc định 1 -> ~175 MB đỉnh với trần dung lượng 100 MB. Nâng lên
  // thì nhân thẳng: `song song x (cỡ video + 75 MB)`, và `kiemRamVideo` chặn
  // nếu vượt 25% RAM máy chủ.
  VIDEO_MAX_CONCURRENT: z.coerce.number().int().min(1).max(8).default(1),
  // Số lần thử MỖI nguồn. Đo: 4 lần -> 5/6 phiên thành công với yt-dlp trên
  // TikTok (nguồn hay bị trang thử thách chống bot).
  VIDEO_SOURCE_RETRIES: z.coerce.number().int().min(1).max(10).default(4),
  // Nghỉ giữa hai lần thử. PHẢI >= 1000: TikWM giới hạn 1 request/giây (đo
  // thật, họ báo thẳng `Free Api Limit: 1 request/second`), nghỉ ngắn hơn là
  // lần thử lại tự đâm vào giới hạn rồi ta tưởng nguồn hỏng.
  VIDEO_RETRY_DELAY_MS: z.coerce.number().int().min(1000).max(30_000).default(1500),

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
  // Đường chạy yt-dlp cho tool `tai_video`. KHÔNG có `.default()` vì "không đặt"
  // là một trạng thái có nghĩa riêng: `YTDLP_PATH` trống thì chạy
  // `<PYTHON_PATH> -m yt_dlp`, còn `PYTHON_PATH` trống thì lùi về `python`.
  // Khai ở đây để hai biến này tra được cùng chỗ với mọi biến khác - gõ nhầm
  // `YT_DLP_PATH` trong compose thì trước đây rơi về mặc định trong im lặng.
  // KHÔNG nhầm `PYTHON_PATH` với `PYTHONPATH`: biến sau nạp mã Python vào tiến
  // trình và bị danh sách cho phép trong `chay-yt-dlp.ts` cố ý chặn.
  YTDLP_PATH: z.string().optional(),
  PYTHON_PATH: z.string().optional(),
  SEND_DELAY_MIN_MS: z.coerce.number().int().min(0).default(800),
  SEND_DELAY_MAX_MS: z.coerce.number().int().min(0).default(2500),
  // Zalo chặn tin quá dài ở phía server (error_code 118 "Nội dung quá dài") -
  // zca-js không kiểm gì nên vượt ngưỡng là mất trắng cả câu trả lời. Đo được:
  // chính Zalo tự cắt tin dán vào thành đoạn 2613 ký tự, tức trần thật >= 2613;
  // repo tham khảo zalo-personal chốt 4000 làm trần cứng và 2000 mỗi đoạn gửi.
  // Để 2000 cho có biên (phòng khi Zalo tính theo BYTE - tiếng Việt 1 ký tự
  // ~1.4 byte). Nâng lên thì ít tin hơn nhưng gần ngưỡng vỡ hơn.
  ZALO_RICH_TEXT_ENABLED: z.preprocess(emptyToUndefined, z.stringbool().default(true)),
  // 2800 chứ không phải 3000: mốc cao nhất ĐO ĐƯỢC là gửi được là 2867 byte,
  // mốc thấp nhất đo được là bị chối là 3712. Lấy ngay dưới mốc đã chứng minh
  // thay vì đoán giữa khoảng - phần dư dành cho sai số giữa JSON mình tính và
  // JSON zca-js thật sự gửi (nó còn đổi `ind_$` thành `ind_10`).
  ZALO_RICH_TEXT_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1000).max(3600).default(3250),
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
  ZALO_BOT_POLL_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(60).default(30),

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

  // ===== Kho tri thức (KB): cắt tài liệu nạp lên thành đoạn để tra bằng bm25 =====
  // 1200 ký tự xấp xỉ 300 token với tiếng Việt (~4 ký tự/token) - đoạn nhỏ hơn
  // giúp bm25 chính xác hơn (avgdl nhỏ, chuẩn hóa độ dài đỡ phạt oan đoạn dài)
  // và nhét được nhiều đoạn hơn trong cùng KB_MAX_RESULT_CHARS. Đi kèm ràng
  // buộc chéo ở runtime-tuning-settings.ts: KB_MAX_RESULT_CHARS phải đủ chỗ
  // cho KB_TOP_K đoạn cỡ này, không thì phần cuối bị vứt lặng lẽ.
  KB_CHUNK_CHARS: z.coerce.number().int().min(400).max(4000).default(1200),
  // Đo 1/2026 trên SPLADE + Mistral-8B: chồng lấn không có lợi ích rõ rệt nên
  // mặc định thấp - vẫn chỉnh được vì kho của người dùng khác corpus benchmark.
  KB_CHUNK_OVERLAP_PERCENT: z.coerce.number().int().min(0).max(50).default(10),
  // Số đoạn trả về mỗi lần tra cứu (sau khi hợp nhất RRF).
  KB_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  // Hằng số k của RRF - 60 là mặc định của Elasticsearch/OpenSearch/Qdrant
  // cho corpus cỡ TREC hàng nghìn tài liệu; kho 100-300 trang thì khuyến nghị
  // 10-20, k nhỏ hơn làm top của mỗi danh sách có trọng lượng hơn.
  KB_RRF_K: z.coerce.number().int().min(5).max(100).default(20),
  // Trần ký tự cho TOÀN BỘ chuỗi kết quả tool kb_search (thẻ bọc + tên nguồn +
  // nội dung), không phải riêng từng đoạn. 8000 ~ 3.200 token ~ 3,6% ngân sách
  // an toàn của một lượt (128k * 0.7) - đủ chỗ cho KB_TOP_K=5 đoạn KB_CHUNK_CHARS
  // =1200 (ràng buộc chéo ở runtime-tuning-settings.ts canh ba số này).
  //
  // min NÂNG lên 2000 (từ 500, vòng rà soát lần 2): đo được phần VỎ một mình
  // (thẻ bọc + ba dòng dặn dò) đã tốn 313-513 ký tự tùy độ dài câu hỏi - ở
  // min cũ 500, một câu hỏi hơi dài (nguồn ~200 ký tự) làm ngân sách NỘI DUNG
  // = 0, model nhận đúng 1 ký tự nội dung dù kho có bao nhiêu đoạn khớp. 2000
  // chừa tối thiểu ~1480 ký tự nội dung ở ca xấu nhất.
  KB_MAX_RESULT_CHARS: z.coerce.number().int().min(2000).max(20_000).default(8000),
  // Trần dung lượng mỗi file nạp lên Kho tri thức - chặn ở TẦNG ĐỌC (middleware
  // hono/body-limit đọc theo luồng, huỷ ngay khi vượt trần) chứ không đợi đọc
  // hết vào RAM rồi mới báo quá lớn.
  KB_MAX_FILE_MB: z.coerce.number().int().min(1).max(100).default(20),
  // Trần thời gian trích xuất MỘT tài liệu trong worker thread riêng - quá hạn
  // thì `terminate()` worker (cách DUY NHẤT dừng được code đồng bộ đang quay
  // CPU) và đánh dấu lượt này bị dừng giữa chừng, xem chay-trich-xuat-tach-luong.ts.
  //
  // Sàn Zod ở đây (100ms) THẤP HƠN sàn thật cho người vận hành (min: 5000 ở
  // tuning-definitions.ts) - CỐ Ý, không phải lệch sót. `getTuning()` chỉ kẹp
  // theo tuning-definitions.ts khi CÓ dòng đè trong DB (dashboard); không có
  // dòng đè thì trả THẲNG giá trị env này - dashboard vẫn không cho nhập dưới
  // 5 giây (route tuning-routes.ts kiểm riêng theo tuning-definitions.ts). Sàn
  // thấp ở đây CHỈ mở đường cho test set thẳng qua biến môi trường
  // (`setupTestEnv({ KB_EXTRACT_TIMEOUT_MS: "300" })`) để dựng được một lần
  // quá hạn THẬT qua worker.xuLyMotVong() - đã đo: không có tài liệu hợp lệ
  // nào (trong mọi trần ooxml-limits.ts) chạm nổi 5000ms thật, nên không có
  // cách nào test nhánh "worker bị terminate() vì quá hạn" bằng một trần hợp
  // lệ với người dùng thật.
  //
  // Sàn Zod thấp KHÔNG được để hổng luôn hàng rào cho `.env` thật (ai gõ nhầm
  // giây thành mili-giây vẫn boot êm re, Kho tri thức chết câm toàn hệ thống
  // mà đổ oan cho "tài liệu độc") - chốt riêng ở CUỐI file này
  // (`env.NODE_ENV !== "test" && env.KB_EXTRACT_TIMEOUT_MS < 5000`) mới là
  // hàng rào thật, sàn Zod ở đây chỉ còn tác dụng chặn số ÂM/không phải số.
  KB_EXTRACT_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(60_000),
  // Số lần GIÀNH xử lý tối đa cho một nguồn trước khi bỏ hẳn (đánh "hong") -
  // chặn nguồn làm worker treo/chết lặp lại vô hạn qua các lần khởi động lại.
  // Đếm tăng NGAY LÚC GIÀNH (giaNguonChoXuLy), không phải lúc phát hiện hỏng.
  KB_MAX_INGEST_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  // Trần RAM (old space của V8) cho worker trích xuất - cầu dao thứ HAI, song
  // song với KB_EXTRACT_TIMEOUT_MS: trần thời gian bắt tài liệu quay CPU,
  // trần này bắt tài liệu PHÌNH HEAP JS. Đo được `resourceLimits` mặc định của
  // Node là maxOldGenerationSizeMb = 4096, tức worker được phép ăn 4 GB trong
  // một container 768 MB.
  //
  // Trần TRÊN 256 (không phải 512): trần heap THẬT của worker là
  // maxOld + maxYoung, mà maxYoung đặt cứng 32 MB - nên 256 nghĩa là 288 MB.
  // Cộng ~384 MB old space của luồng chính là 672/768 MB, còn ~96 MB đệm cho
  // RSS overhead (đo: RSS 321 MB khi heapUsed mới 206 MB). Để max 512 thì
  // riêng worker đã 544 MB - kéo thanh trượt hết cỡ là tự cầm chắc OOM-kill.
  // Xem chay-trich-xuat-tach-luong.ts cho bảng đo và HAI GIỚI HẠN của cầu dao.
  KB_EXTRACT_MAX_RAM_MB: z.coerce.number().int().min(64).max(256).default(192),

  // Dashboard web (Hono, cùng process). Không set DASHBOARD_PASSWORD = dashboard tắt.
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3900),
  /**
   * Địa chỉ dashboard lắng nghe. Mặc định `127.0.0.1` - chạy trên máy hay chạy
   * thẳng trên VPS thì không bao giờ tự phơi ra internet.
   *
   * TRONG DOCKER PHẢI ĐẶT `0.0.0.0`, và đây là chỗ dễ mất cả buổi để hiểu:
   * `127.0.0.1` bên trong container là loopback CỦA CONTAINER, Docker không
   * chuyển tiếp cổng vào đó được, nên reverse proxy chỉ nhận connection
   * refused. Việc chặn phơi ra ngoài chuyển sang phía HOST bằng cách publish
   * `127.0.0.1:<cổng host>:<cổng container>` - đúng chỗ nó nên nằm, vì Docker
   * ghi thẳng iptables và đi vòng qua UFW.
   */
  DASHBOARD_HOST: z.string().min(1).default("127.0.0.1"),
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

// KHÔNG chặn boot khi thiếu LLM_BASE_URL, dù provider mặc định cần nó.
//
// Base URL nhập được ở trang Providers (lưu DB, và DB ĐÈ env), nên chặn ở đây
// là chặn đúng người vừa cài xong và chưa kịp vào dashboard - mà không vào
// được dashboard thì không có đường nào nhập. `resolveLanguageModel` đã ném lỗi
// nói rõ ở lượt agent đầu tiên, sau khi đã hợp nhất DB với env, nên chỗ đó mới
// là nơi biết đủ để phán xét.

if (env.SEND_DELAY_MAX_MS < env.SEND_DELAY_MIN_MS) {
  console.error("SEND_DELAY_MAX_MS phải >= SEND_DELAY_MIN_MS");
  process.exit(1);
}

// Giữ ít hơn số tin agent đọc mỗi lượt = vừa ghi xong đã bị xóa mất context
if (env.HISTORY_MAX_MESSAGES_PER_THREAD < env.HISTORY_CONTEXT_LIMIT) {
  console.error("HISTORY_MAX_MESSAGES_PER_THREAD phải >= HISTORY_CONTEXT_LIMIT");
  process.exit(1);
}

// Sàn Zod của KB_EXTRACT_TIMEOUT_MS (min: 100, xem comment tại schema) THẤP
// HƠN HẲN sàn thật (5000ms) - CỐ Ý, nhưng CHỈ để test set qua process.env né
// qua DB. Thiếu chốt RIÊNG này thì sàn Zod thấp trở thành hàng rào boot DUY
// NHẤT cho `.env` thật: ai gõ nhầm "600" với ý "600 giây" vẫn boot êm re, rồi
// MỌI tài liệu quá hạn và bị đổ oan là "tài liệu độc" trong khi gốc rễ là một
// dòng `.env`. Không áp cho NODE_ENV=test - `setupTestEnv()` cần đặt được
// dưới 5000ms để dựng ca quá hạn thật (xem chay-trich-xuat-tach-luong.ts).
if (env.NODE_ENV !== "test" && env.KB_EXTRACT_TIMEOUT_MS < 5000) {
  console.error("KB_EXTRACT_TIMEOUT_MS phải >= 5000 (dưới 5s chỉ dùng cho test)");
  process.exit(1);
}

export const dataDir = path.resolve(env.DATA_DIR);
fs.mkdirSync(dataDir, { recursive: true });
