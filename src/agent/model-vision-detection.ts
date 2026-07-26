import { getEffectiveLlmSettings } from "../config/runtime-llm-settings.js";
import { getVisionSettings } from "../config/runtime-vision-settings.js";
import { createLogger } from "../shared/logger.js";
import type { ModelOverride } from "./llm-provider.js";

/**
 * Model đang hiệu lực có đọc được ảnh không?
 *
 * mode on/off: ép tay. mode auto: hỏi router qua GET {baseUrl}/models - 9Router
 * trả `capabilities.vision` cho từng model (đúng nguồn dữ liệu của icon con mắt
 * trên UI router, xem 9router/src/app/api/v1/models/route.js). Endpoint OpenAI
 * chuẩn không có field capabilities -> "không biết" -> coi như CÓ vision để giữ
 * hành vi cũ (router như 9Router tự lột ảnh nếu mình đoán sai, không crash).
 *
 * Anthropic trực tiếp luôn true - mọi model Claude còn phục vụ đều có vision.
 */

const log = createLogger("vision-detection");

/** Kết quả tra /models cache 10 phút - đổi model/router không phải đợi quá lâu */
const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  /** vision theo model id; model không có trong list thì không có key */
  visionByModel: Map<string, boolean>;
  expiresAt: number;
};

/** Cache theo baseUrl - nhiều agent khác model vẫn chung 1 lần gọi /models */
const cacheByBaseUrl = new Map<string, CacheEntry>();

export type ModelsFetcher = (url: string, apiKey: string) => Promise<unknown>;

const defaultFetcher: ModelsFetcher = async (url, apiKey) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
};

/** Bóc map model -> vision từ response /models. Entry thiếu capabilities bị bỏ qua. */
export function parseModelsCapabilities(payload: unknown): Map<string, boolean> {
  const visionByModel = new Map<string, boolean>();
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return visionByModel;
  for (const entry of data) {
    const id = (entry as { id?: unknown })?.id;
    const vision = (entry as { capabilities?: { vision?: unknown } })?.capabilities?.vision;
    if (typeof id === "string" && typeof vision === "boolean") {
      visionByModel.set(id, vision);
    }
  }
  return visionByModel;
}

async function lookupVisionFromRouter(
  baseUrl: string,
  apiKey: string,
  model: string,
  fetcher: ModelsFetcher,
): Promise<boolean | undefined> {
  const cached = cacheByBaseUrl.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.visionByModel.get(model);
  }

  let visionByModel = new Map<string, boolean>();
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    visionByModel = parseModelsCapabilities(await fetcher(url, apiKey));
  } catch (err) {
    // Router không trả /models được thì coi như "không biết" - cũng cache để
    // không đập /models mỗi tin nhắn khi router đang trục trặc
    log.debug({ baseUrl, err }, "Không tra được /models - coi như model có vision");
  }
  cacheByBaseUrl.set(baseUrl, { visionByModel, expiresAt: Date.now() + CACHE_TTL_MS });
  return visionByModel.get(model);
}

/** Xóa cache - gọi khi đổi cấu hình provider/vision từ dashboard */
export function clearVisionDetectionCache(): void {
  cacheByBaseUrl.clear();
}

/**
 * Quyết định model đang hiệu lực (override agent -> runtime settings -> env,
 * cùng thứ tự với resolveLanguageModel) có đọc được ảnh không.
 */
export async function modelReadsImages(
  override?: ModelOverride,
  fetcher: ModelsFetcher = defaultFetcher,
): Promise<boolean> {
  const { mode } = getVisionSettings();
  if (mode === "on") return true;
  if (mode === "off") return false;

  const base = getEffectiveLlmSettings();
  const provider = override?.modelProvider ?? base.provider;
  const model = override?.modelName ?? base.model;

  if (provider === "anthropic") return true;
  if (!base.baseUrl || !base.apiKey) return true;

  const detected = await lookupVisionFromRouter(base.baseUrl, base.apiKey, model, fetcher);
  if (detected === false) {
    log.info({ model }, "Router báo model không đọc được ảnh - bỏ ảnh khỏi request");
  }
  // undefined = router không biết model này (combo, endpoint ngoài 9Router) -> true
  return detected !== false;
}
