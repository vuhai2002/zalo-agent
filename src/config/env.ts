import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Nạp .env bằng API built-in của Node (>= 20.12); thiếu file thì lấy env từ OS
try {
  process.loadEnvFile();
} catch {
  /* không có .env - dùng biến môi trường hệ thống */
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  DATA_DIR: z.string().default("./data"),

  LLM_PROVIDER: z.enum(["openai-compatible", "anthropic"]).default("openai-compatible"),
  LLM_BASE_URL: z.string().startsWith("http").optional(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_MAX_STEPS: z.coerce.number().int().min(1).max(30).default(8),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(2048),

  HISTORY_CONTEXT_LIMIT: z.coerce.number().int().min(1).max(200).default(20),
  SEND_DELAY_MIN_MS: z.coerce.number().int().min(0).default(800),
  SEND_DELAY_MAX_MS: z.coerce.number().int().min(0).default(2500),
  // Thời gian chờ gộp tin nhắn cùng thread thành 1 lượt agent (ảnh + caption,
  // hoặc user nhắn liền nhiều tin ngắn). Cao hơn = gộp tốt hơn nhưng trả lời chậm hơn.
  MESSAGE_BATCH_DEBOUNCE_MS: z.coerce.number().int().min(0).max(15000).default(2500),

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

export const dataDir = path.resolve(env.DATA_DIR);
fs.mkdirSync(dataDir, { recursive: true });
