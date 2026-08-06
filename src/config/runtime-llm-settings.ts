import { db } from "../conversation/database.js";
import type { LlmProviderKind } from "./llm-provider-kind.js";
import { env } from "./env.js";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-cipher.js";
import { createLogger } from "../shared/logger.js";

/**
 * Override cấu hình LLM lúc runtime (đổi từ dashboard, áp dụng ngay không cần
 * restart). Ưu tiên: runtime_settings (DB) -> env. API key lưu DB được mã hóa
 * AES-256-GCM cùng key với cookie Zalo; base64("iv|authTag|ciphertext").
 * User đã chốt cho sửa cả API key qua UI dù được cảnh báo trade-off.
 */

export type LlmSettings = {
  provider: LlmProviderKind;
  baseUrl: string | undefined;
  model: string;
  apiKey: string;
  /** true = đang dùng override từ DB (ít nhất 1 field), false = thuần env */
  hasOverride: boolean;
  /**
   * DB CÓ khóa nhưng giải mã HỎNG - gần như luôn là vì
   * `CREDENTIALS_ENCRYPTION_KEY` đã đổi so với lúc lưu.
   *
   * Phải phân biệt với "chưa nhập bao giờ": hai bên nhìn giống nhau (đều không
   * có khóa dùng được) nhưng cách sửa khác hẳn - một bên là nhập lần đầu, một
   * bên là khóa mã hóa sai và mọi secret khác trong DB (cookie Zalo) cũng đang
   * hỏng theo.
   */
  apiKeyHong: boolean;
};

const log = createLogger("llm-settings");

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

/**
 * Giải mã API key mà KHÔNG để lỗi thoát ra.
 *
 * `decryptSecret` ném khi `CREDENTIALS_ENCRYPTION_KEY` đổi so với lúc lưu, và
 * hàm này nằm trên đường đi của MỌI lượt agent lẫn của `/api/overview`. Để lỗi
 * thoát ra thì:
 *
 *   - Lượt agent: `Error` thường -> `phanLoaiLoiProvider` ra `unknown` -> người
 *     nhắn nhận câu "bạn nhắn lại sau ít phút nhé" cho một tình trạng VĨNH VIỄN.
 *     Đúng cái bệnh mà `LoiCauHinhLlm` sinh ra để chữa.
 *   - Dashboard: `/api/overview` trả 500, tức trang đầu tiên người ta mở để
 *     hiểu chuyện gì đang xảy ra lại là trang chết.
 *
 * Trả `hong: true` để caller nói ĐÚNG bệnh thay vì im lặng rơi về `.env` - rơi
 * về env còn tệ hơn: bot chạy bằng một khóa khác khóa người dùng vừa nhập trên
 * dashboard mà không ai biết.
 */
function giaiMaAnToan(encrypted: string | undefined): { value?: string; hong: boolean } {
  if (!encrypted) return { hong: false };
  try {
    return { value: decryptSecret(encrypted), hong: false };
  } catch (err) {
    log.error(
      { err },
      "Không giải mã được LLM API key trong DB - CREDENTIALS_ENCRYPTION_KEY có đúng khóa lúc lưu không?",
    );
    return { hong: true };
  }
}

/** Cấu hình LLM hiệu lực hiện tại (override DB đè lên env) */
export function getEffectiveLlmSettings(): LlmSettings {
  const provider = read("llm_provider");
  const baseUrl = read("llm_base_url");
  const model = read("llm_model");
  const encryptedApiKey = read("llm_api_key");

  const key = giaiMaAnToan(encryptedApiKey);

  return {
    provider: (provider as LlmSettings["provider"]) ?? env.LLM_PROVIDER,
    baseUrl: baseUrl ?? env.LLM_BASE_URL,
    model: model ?? env.LLM_MODEL,
    apiKey: key.hong ? "" : (key.value ?? env.LLM_API_KEY),
    hasOverride: Boolean(provider || baseUrl || model || encryptedApiKey),
    apiKeyHong: key.hong,
  };
}

export type LlmSettingsUpdate = {
  provider?: LlmProviderKind;
  /**
   * `undefined` = GIỮ NGUYÊN giá trị đang lưu, `null` = XÓA hẳn.
   *
   * Cần phân biệt hai thứ đó vì base URL chỉ có nghĩa với `openai-compatible`.
   * Khi chỉ có "giữ nguyên", đổi sang Anthropic hay Google là URL của nhà cũ
   * nằm lại trong DB vĩnh viễn rồi hiện lại lúc quay về - người dùng thấy ô
   * Base URL vẫn là endpoint của hãng đã bỏ và tưởng dashboard hỏng.
   */
  baseUrl?: string | null;
  model?: string;
  /** Bỏ trống = giữ key hiện tại */
  apiKey?: string;
};

export function updateLlmSettings(update: LlmSettingsUpdate): void {
  if (update.provider !== undefined) setStmt.run("llm_provider", update.provider);
  if (update.baseUrl === null) delStmt.run("llm_base_url");
  else if (update.baseUrl !== undefined) setStmt.run("llm_base_url", update.baseUrl);
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
