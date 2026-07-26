import { db } from "../conversation/database.js";
import { env } from "./env.js";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-cipher.js";

/**
 * Cấu hình các tool web sửa được từ dashboard (nút Settings trên dòng tool ở
 * trang Tools), lưu trong bảng runtime_settings dùng chung. Key Brave mã hóa
 * AES-256-GCM như key LLM.
 *
 * Cả hai tool đều là CHUỖI có thứ tự (mô hình Extractor Chain của GoClaw):
 * thử từ trên xuống tới khi có kết quả dùng được. Bậc CUỐI của mỗi chuỗi
 * không tắt được - nhờ vậy tool không bao giờ rơi vào trạng thái "chưa cấu
 * hình": web_search luôn còn DuckDuckGo, web_fetch luôn còn tầng tự tải.
 */

export type SearchProvider = "duckduckgo" | "brave";

export type SearchSettings = {
  provider: SearchProvider;
  /** Rỗng nghĩa là chưa có key ở cả DB lẫn env */
  braveApiKey: string;
};

const PROVIDER_KEY = "search_provider";
const BRAVE_KEY = "search_brave_api_key";

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

/** Key Brave hiệu lực: DB (nhập từ dashboard) đè lên env */
export function getBraveApiKey(): string {
  const stored = read(BRAVE_KEY);
  if (stored) {
    try {
      return decryptSecret(stored);
    } catch {
      // Key hỏng (đổi CREDENTIALS_ENCRYPTION_KEY) - rơi về env thay vì chết tool
      return env.BRAVE_SEARCH_API_KEY;
    }
  }
  return env.BRAVE_SEARCH_API_KEY;
}

/**
 * Cấu hình đang hiệu lực. Chọn brave nhưng key biến mất (bị xóa tay trong DB,
 * đổi khóa mã hóa) thì tự hạ về duckduckgo - thà tìm được bằng DDG còn hơn
 * gọi Brave với key rỗng rồi lỗi.
 */
export function getSearchSettings(): SearchSettings {
  const braveApiKey = getBraveApiKey();
  const stored = read(PROVIDER_KEY);
  const provider: SearchProvider = stored === "brave" && braveApiKey ? "brave" : "duckduckgo";
  return { provider, braveApiKey };
}

export type SearchSettingsUpdate = {
  provider?: SearchProvider;
  /** Bỏ trống = giữ key hiện tại; chuỗi rỗng tường minh = xóa key */
  braveApiKey?: string;
};

/**
 * Ném lỗi khi chọn brave mà không có key - chặn ở tầng store để API và mọi
 * caller khác đều dính cùng một luật.
 */
export function updateSearchSettings(update: SearchSettingsUpdate): SearchSettings {
  if (update.braveApiKey !== undefined) {
    if (update.braveApiKey === "") delStmt.run(BRAVE_KEY);
    else setStmt.run(BRAVE_KEY, encryptSecret(update.braveApiKey));
  }

  if (update.provider !== undefined) {
    if (update.provider === "brave" && !getBraveApiKey()) {
      throw new Error("Cần nhập API key Brave trước khi bật provider này");
    }
    setStmt.run(PROVIDER_KEY, update.provider);
  }

  return getSearchSettings();
}

/** Dạng an toàn để trả về dashboard - không bao giờ lộ key đầy đủ */
export function getSearchSettingsForApi() {
  const settings = getSearchSettings();
  return {
    provider: settings.provider,
    braveApiKeyMasked: maskSecret(settings.braveApiKey),
    hasBraveApiKey: Boolean(settings.braveApiKey),
  };
}

// ===== web_fetch: chuỗi 2 tầng, tầng tự tải không tắt được =====

const FETCH_FALLBACK_KEY = "fetch_fallback_enabled";

export type FetchSettings = {
  /** Bậc 2 (Jina Reader) - bậc 1 tự tải luôn bật, không có công tắc */
  fallbackEnabled: boolean;
};

export function getFetchSettings(): FetchSettings {
  const stored = read(FETCH_FALLBACK_KEY);
  // Chưa đặt trong DB thì theo env; đặt rồi thì DB thắng
  if (stored === undefined) return { fallbackEnabled: env.WEB_FETCH_FALLBACK_ENABLED };
  return { fallbackEnabled: stored === "true" };
}

export function updateFetchSettings(update: Partial<FetchSettings>): FetchSettings {
  if (update.fallbackEnabled !== undefined) {
    setStmt.run(FETCH_FALLBACK_KEY, String(update.fallbackEnabled));
  }
  return getFetchSettings();
}
