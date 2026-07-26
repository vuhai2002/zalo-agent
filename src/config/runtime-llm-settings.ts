import { db } from "../conversation/database.js";
import { env } from "./env.js";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-cipher.js";

/**
 * Override cấu hình LLM lúc runtime (đổi từ dashboard, áp dụng ngay không cần
 * restart). Ưu tiên: runtime_settings (DB) -> env. API key lưu DB được mã hóa
 * AES-256-GCM cùng key với cookie Zalo; base64("iv|authTag|ciphertext").
 * User đã chốt cho sửa cả API key qua UI dù được cảnh báo trade-off.
 */

export type LlmSettings = {
  provider: "openai-compatible" | "anthropic";
  baseUrl: string | undefined;
  model: string;
  apiKey: string;
  /** true = đang dùng override từ DB (ít nhất 1 field), false = thuần env */
  hasOverride: boolean;
};

const KEYS = ["llm_provider", "llm_base_url", "llm_model", "llm_api_key"] as const;

const getStmt = db.prepare("SELECT value FROM runtime_settings WHERE key = ?");
const setStmt = db.prepare(`
  INSERT INTO runtime_settings (key, value, updated_at)
  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const delStmt = db.prepare("DELETE FROM runtime_settings WHERE key = ?");

function read(key: (typeof KEYS)[number]): string | undefined {
  const row = getStmt.get(key) as { value: string } | undefined;
  return row?.value;
}

/** Cấu hình LLM hiệu lực hiện tại (override DB đè lên env) */
export function getEffectiveLlmSettings(): LlmSettings {
  const provider = read("llm_provider");
  const baseUrl = read("llm_base_url");
  const model = read("llm_model");
  const encryptedApiKey = read("llm_api_key");

  return {
    provider: (provider as LlmSettings["provider"]) ?? env.LLM_PROVIDER,
    baseUrl: baseUrl ?? env.LLM_BASE_URL,
    model: model ?? env.LLM_MODEL,
    apiKey: encryptedApiKey ? decryptSecret(encryptedApiKey) : env.LLM_API_KEY,
    hasOverride: Boolean(provider || baseUrl || model || encryptedApiKey),
  };
}

export type LlmSettingsUpdate = {
  provider?: "openai-compatible" | "anthropic";
  baseUrl?: string;
  model?: string;
  /** Bỏ trống = giữ key hiện tại */
  apiKey?: string;
};

export function updateLlmSettings(update: LlmSettingsUpdate): void {
  if (update.provider !== undefined) setStmt.run("llm_provider", update.provider);
  if (update.baseUrl !== undefined) setStmt.run("llm_base_url", update.baseUrl);
  if (update.model !== undefined) setStmt.run("llm_model", update.model);
  if (update.apiKey !== undefined && update.apiKey !== "") {
    setStmt.run("llm_api_key", encryptSecret(update.apiKey));
  }
}

/** Xóa toàn bộ override - quay về cấu hình env (rollback an toàn) */
export function clearLlmSettings(): void {
  for (const key of KEYS) delStmt.run(key);
}

/** "sk-abc...xyz" - đủ nhận diện key nào, không đủ dùng lại */
export const maskApiKey = maskSecret;
