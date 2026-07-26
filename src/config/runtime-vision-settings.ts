import { db } from "../conversation/database.js";
import { env } from "./env.js";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-cipher.js";

/**
 * Cấu hình đọc ảnh (vision), sửa được từ trang Providers trên dashboard,
 * lưu bảng runtime_settings dùng chung. Ưu tiên DB -> env (cùng luật với
 * runtime-llm-settings). Key sidecar mã hóa AES-256-GCM như mọi key khác.
 *
 * - mode: model CHÍNH có đọc được ảnh không (auto = tự hỏi router).
 * - sidecar: model phụ "đọc ảnh thuê" khi model chính không vision - mô tả
 *   ảnh thành text 1 lần (cache DB), model chính đọc text. Học image_input_mode
 *   auto|native|text + auxiliary.vision của Hermes (agent/image_routing.py).
 */

export type VisionMode = "auto" | "on" | "off";

export type VisionSidecarSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type VisionSettings = {
  mode: VisionMode;
  sidecar: VisionSidecarSettings;
};

const MODE_KEY = "vision_mode";
const SIDECAR_BASE_URL_KEY = "vision_sidecar_base_url";
const SIDECAR_MODEL_KEY = "vision_sidecar_model";
const SIDECAR_API_KEY_KEY = "vision_sidecar_api_key";

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

function readSidecarApiKey(): string {
  const stored = read(SIDECAR_API_KEY_KEY);
  if (stored) {
    try {
      return decryptSecret(stored);
    } catch {
      // Key hỏng (đổi CREDENTIALS_ENCRYPTION_KEY) - rơi về env thay vì chết sidecar
      return env.VISION_SIDECAR_API_KEY;
    }
  }
  return env.VISION_SIDECAR_API_KEY;
}

export function getVisionSettings(): VisionSettings {
  const storedMode = read(MODE_KEY);
  const mode: VisionMode =
    storedMode === "auto" || storedMode === "on" || storedMode === "off"
      ? storedMode
      : env.LLM_VISION_MODE;
  return {
    mode,
    sidecar: {
      baseUrl: read(SIDECAR_BASE_URL_KEY) ?? env.VISION_SIDECAR_BASE_URL ?? "",
      model: read(SIDECAR_MODEL_KEY) ?? env.VISION_SIDECAR_MODEL,
      apiKey: readSidecarApiKey(),
    },
  };
}

/** Sidecar chỉ dùng được khi đủ cả 3: base URL + model + key */
export function isSidecarConfigured(settings = getVisionSettings()): boolean {
  const s = settings.sidecar;
  return Boolean(s.baseUrl && s.model && s.apiKey);
}

export type VisionSettingsUpdate = {
  mode?: VisionMode;
  /** Chuỗi rỗng tường minh = xóa (quay về env) */
  sidecarBaseUrl?: string;
  sidecarModel?: string;
  /** Bỏ trống = giữ key hiện tại; chuỗi rỗng tường minh = xóa key */
  sidecarApiKey?: string;
};

export function updateVisionSettings(update: VisionSettingsUpdate): VisionSettings {
  if (update.mode !== undefined) setStmt.run(MODE_KEY, update.mode);
  if (update.sidecarBaseUrl !== undefined) {
    if (update.sidecarBaseUrl === "") delStmt.run(SIDECAR_BASE_URL_KEY);
    else setStmt.run(SIDECAR_BASE_URL_KEY, update.sidecarBaseUrl);
  }
  if (update.sidecarModel !== undefined) {
    if (update.sidecarModel === "") delStmt.run(SIDECAR_MODEL_KEY);
    else setStmt.run(SIDECAR_MODEL_KEY, update.sidecarModel);
  }
  if (update.sidecarApiKey !== undefined) {
    if (update.sidecarApiKey === "") delStmt.run(SIDECAR_API_KEY_KEY);
    else setStmt.run(SIDECAR_API_KEY_KEY, encryptSecret(update.sidecarApiKey));
  }
  return getVisionSettings();
}

/**
 * Xóa sạch cấu hình sidecar (gồm cả API key) - quay về giá trị env, thường là
 * trống nghĩa là tắt hẳn sidecar. Cần hành động riêng vì đường PATCH quy ước
 * "key bỏ trống = giữ key cũ", nên không có cách nào gỡ key qua PATCH từ UI.
 */
export function clearSidecarSettings(): VisionSettings {
  for (const key of [SIDECAR_BASE_URL_KEY, SIDECAR_MODEL_KEY, SIDECAR_API_KEY_KEY]) {
    delStmt.run(key);
  }
  return getVisionSettings();
}

/** Dạng an toàn trả về dashboard - không bao giờ lộ key đầy đủ */
export function getVisionSettingsForApi() {
  const settings = getVisionSettings();
  return {
    mode: settings.mode,
    sidecar: {
      baseUrl: settings.sidecar.baseUrl,
      model: settings.sidecar.model,
      apiKeyMasked: maskSecret(settings.sidecar.apiKey),
      // Cờ riêng vì apiKeyMasked KHÔNG BAO GIỜ rỗng (trống thì ra "chưa cấu
      // hình") - UI không thể suy ra "có key hay không" từ chuỗi mask
      hasApiKey: Boolean(settings.sidecar.apiKey),
      configured: isSidecarConfigured(settings),
    },
  };
}
