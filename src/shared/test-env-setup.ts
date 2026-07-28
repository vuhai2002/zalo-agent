import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Chuẩn bị env cho test. PHẢI gọi TRƯỚC khi import bất kỳ module nào chạm
 * `src/config/env.ts` - module đó gọi `process.exit(1)` khi env không hợp lệ,
 * đủ để giết cả test runner. Vì vậy test phải dùng `await import()` động thay vì
 * import tĩnh ở đầu file.
 *
 * `process.loadEnvFile()` không ghi đè biến đã có sẵn trong process.env, nên các
 * giá trị set ở đây thắng file `.env` của máy dev - test chạy giống nhau ở mọi máy.
 * Vì lý do đó phải set đủ mọi biến mà test quan tâm, không chỉ biến bắt buộc.
 *
 * Trả về đường dẫn thư mục data tạm (mỗi lần gọi một thư mục riêng) để test tự dọn.
 */
export function setupTestEnv(overrides: Record<string, string> = {}): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-agent-test-"));

  const values: Record<string, string> = {
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    // Test không cần file log: mỗi file test sẽ đẻ một worker pino-roll và một
    // file trong thư mục tạm, tốn công mà chẳng ai đọc
    LOG_FILE_ENABLED: "false",
    DATA_DIR: dataDir,

    // anthropic để khỏi cần LLM_BASE_URL; test không gọi LLM thật
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model",
    LLM_MAX_STEPS: "8",
    LLM_MAX_OUTPUT_TOKENS: "2048",

    HISTORY_CONTEXT_LIMIT: "20",
    HISTORY_MAX_MESSAGES_PER_THREAD: "500",
    SEND_DELAY_MIN_MS: "0",
    SEND_DELAY_MAX_MS: "0",
    MESSAGE_BATCH_DEBOUNCE_MS: "20",

    // Test chạy như chạy local: không tin X-Forwarded-For, cookie không cần Secure
    DASHBOARD_BEHIND_PROXY: "false",

    CREDENTIALS_ENCRYPTION_KEY: "0".repeat(64),

    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  return dataDir;
}

/** Xóa thư mục data tạm sau khi test xong */
export function cleanupTestEnv(dataDir: string): void {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
