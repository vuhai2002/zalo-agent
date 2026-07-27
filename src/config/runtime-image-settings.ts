import { db } from "../conversation/database.js";
import { env } from "./env.js";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-cipher.js";

/**
 * Cấu hình tool vẽ ảnh, sửa được từ modal Settings của dòng tool trên trang
 * Tools. Lưu bảng runtime_settings dùng chung, ưu tiên DB -> env, key mã hóa
 * AES-256-GCM (cùng luật với runtime-vision-settings).
 *
 * Khác sidecar đọc ảnh ở một điểm quan trọng: KHÔNG tự dò được model. Endpoint
 * /v1/models của router chỉ liệt kê model chat - model vẽ ảnh nằm ở registry
 * Media Providers riêng nên không có `capabilities` để hỏi. Người dùng phải tự
 * gõ tên model, và kiểm chứng bằng nút Test (gọi thật một lần).
 */

export type ImageGenSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

const BASE_URL_KEY = "image_gen_base_url";
const MODEL_KEY = "image_gen_model";
const API_KEY_KEY = "image_gen_api_key";

const getStmt = db.prepare("SELECT value FROM runtime_settings WHERE key = ?");
const setStmt = db.prepare(`
  INSERT INTO runtime_settings (key, value, updated_at)
  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const delStmt = db.prepare("DELETE FROM runtime_settings WHERE key = ?");

function read(key: string): string | undefined {
  return (getStmt.get(key) as { value: string } | undefined)?.value;
}

function readApiKey(): string {
  const stored = read(API_KEY_KEY);
  if (stored) {
    try {
      return decryptSecret(stored);
    } catch {
      // Key hỏng (đổi CREDENTIALS_ENCRYPTION_KEY) - rơi về env thay vì chết tool
      return env.IMAGE_GEN_API_KEY;
    }
  }
  return env.IMAGE_GEN_API_KEY;
}

export function getImageSettings(): ImageGenSettings {
  return {
    baseUrl: read(BASE_URL_KEY) ?? env.IMAGE_GEN_BASE_URL ?? "",
    model: read(MODEL_KEY) ?? env.IMAGE_GEN_MODEL,
    apiKey: readApiKey(),
  };
}

/** Vẽ được khi đủ cả 3: base URL + model + key */
export function isImageGenConfigured(settings = getImageSettings()): boolean {
  return Boolean(settings.baseUrl && settings.model && settings.apiKey);
}

export type ImageSettingsUpdate = {
  /** Chuỗi rỗng tường minh = xóa (quay về env) */
  baseUrl?: string;
  model?: string;
  /** Bỏ trống = giữ key hiện tại; chuỗi rỗng tường minh = xóa key */
  apiKey?: string;
};

export function updateImageSettings(update: ImageSettingsUpdate): ImageGenSettings {
  const apply = (key: string, value: string | undefined, encrypt = false): void => {
    if (value === undefined) return;
    if (value === "") delStmt.run(key);
    else setStmt.run(key, encrypt ? encryptSecret(value) : value);
  };
  apply(BASE_URL_KEY, update.baseUrl);
  apply(MODEL_KEY, update.model);
  apply(API_KEY_KEY, update.apiKey, true);
  return getImageSettings();
}

/**
 * Xóa sạch cấu hình (gồm cả API key) - quay về env, thường là trống nghĩa là
 * tắt hẳn tool. Cần hành động riêng vì đường PATCH quy ước "key bỏ trống = giữ
 * key cũ", nên không có cách nào gỡ key qua PATCH từ UI.
 */
export function clearImageSettings(): ImageGenSettings {
  for (const key of [BASE_URL_KEY, MODEL_KEY, API_KEY_KEY]) delStmt.run(key);
  return getImageSettings();
}

/** Dạng an toàn trả về dashboard - không bao giờ lộ key đầy đủ */
export function getImageSettingsForApi() {
  const settings = getImageSettings();
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyMasked: maskSecret(settings.apiKey),
    // Cờ riêng vì apiKeyMasked KHÔNG BAO GIỜ rỗng (trống thì ra "chưa cấu
    // hình") - UI không thể suy ra "có key hay không" từ chuỗi mask
    hasApiKey: Boolean(settings.apiKey),
    configured: isImageGenConfigured(settings),
  };
}
