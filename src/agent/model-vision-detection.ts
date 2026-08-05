import { laGoiThangHang } from "../config/llm-provider-kind.js";
import { getEffectiveLlmSettings } from "../config/runtime-llm-settings.js";
import { getVisionSettings } from "../config/runtime-vision-settings.js";
import { createLogger } from "../shared/logger.js";
import { modelHieuLuc, type ModelOverride } from "./llm-provider.js";

/**
 * Model đang hiệu lực có đọc được ảnh không?
 *
 * mode on/off: ép tay. mode auto: hỏi router qua GET {baseUrl}/models - 9Router
 * trả `capabilities.vision` cho từng model (đúng nguồn dữ liệu của icon con mắt
 * trên UI router) và đánh dấu combo bằng `owned_by: "combo"` (kiểm chứng thật
 * trên instance đang chạy). Endpoint OpenAI chuẩn không có các field này ->
 * "unknown" -> coi như CÓ vision để giữ hành vi cũ.
 *
 * Phân loại 4 trạng thái thay vì boolean vì combo cần đối xử riêng: combo trộn
 * thành viên có/không vision, 9Router auto-switch đẩy thành viên vision lên đầu
 * khi lượt hiện tại có ảnh, nhưng ảnh HISTORY thì chủ đích không pin combo
 * (combo.js: "History media must not pin the combo") - rơi vào thành viên mù là
 * ảnh bị lột êm. Chế độ hybrid (đính cả pixel + mô tả) chữa đúng lỗ này.
 *
 * Cache ÂM (markModelNoVision): reactive fallback ở agent-loop phát hiện model
 * từ chối ảnh bằng HTTP 4xx thì ghi nhớ tại đây - các lượt sau đi thẳng
 * describe/blind thay vì đâm đầu lại.
 */

const log = createLogger("vision-detection");

/** Kết quả tra /models cache 10 phút - đổi model/router không phải đợi quá lâu */
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ModelVisionKind = "vision" | "no-vision" | "combo" | "unknown";

type CacheEntry = {
  /** vision theo model id; model không có capabilities thì không có key */
  visionByModel: Map<string, boolean>;
  /** id các combo (owned_by = "combo") - không có capabilities nhưng biết là combo */
  comboIds: Set<string>;
  expiresAt: number;
};

/** Cache theo baseUrl - nhiều agent khác model vẫn chung 1 lần gọi /models */
const cacheByBaseUrl = new Map<string, CacheEntry>();

/**
 * Cache âm: model đã từ chối ảnh bằng lỗi 4xx thật (reactive fallback ghi vào).
 * Key `${baseUrl}|${model}`. Thắng kết quả /models vì đây là bằng chứng thật
 * từ chính provider, còn /models có thể lạc quan (unknown coi như có vision).
 */
const noVisionUntil = new Map<string, number>();

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

/** Bóc map vision + danh sách combo từ response /models */
export function parseModelsCapabilities(payload: unknown): {
  visionByModel: Map<string, boolean>;
  comboIds: Set<string>;
} {
  const visionByModel = new Map<string, boolean>();
  const comboIds = new Set<string>();
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return { visionByModel, comboIds };
  for (const entry of data) {
    const id = (entry as { id?: unknown })?.id;
    if (typeof id !== "string") continue;
    const vision = (entry as { capabilities?: { vision?: unknown } })?.capabilities?.vision;
    if (typeof vision === "boolean") visionByModel.set(id, vision);
    if ((entry as { owned_by?: unknown })?.owned_by === "combo") comboIds.add(id);
  }
  return { visionByModel, comboIds };
}

async function lookupFromRouter(
  baseUrl: string,
  apiKey: string,
  fetcher: ModelsFetcher,
): Promise<CacheEntry> {
  const cached = cacheByBaseUrl.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached;

  let parsed = { visionByModel: new Map<string, boolean>(), comboIds: new Set<string>() };
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    parsed = parseModelsCapabilities(await fetcher(url, apiKey));
  } catch (err) {
    // Router không trả /models được thì coi như "không biết" - cũng cache để
    // không đập /models mỗi tin nhắn khi router đang trục trặc
    log.debug({ baseUrl, err }, "Không tra được /models - coi như model có vision");
  }
  const entry: CacheEntry = { ...parsed, expiresAt: Date.now() + CACHE_TTL_MS };
  cacheByBaseUrl.set(baseUrl, entry);
  return entry;
}

/**
 * Reactive fallback gọi khi provider TỪ CHỐI ảnh bằng lỗi 4xx: ghi nhớ model
 * đang hiệu lực không đọc được ảnh để các lượt sau đi thẳng describe/blind.
 * Đường gọi thẳng hãng (Anthropic, Google) không bao giờ bị đánh dấu - Claude
 * và Gemini đều đọc được ảnh, lỗi 4xx ở đó là chuyện khác (ảnh quá cỡ, request
 * hỏng), đánh dấu chỉ gây hại. Đã dính thật với Gemini: một lỗi 400 vì thiếu
 * thought_signature bị quy cho ảnh, và model đọc ảnh được vẫn bị coi là mù.
 */
export function markModelNoVision(override?: ModelOverride): void {
  const base = getEffectiveLlmSettings();
  // Qua `modelHieuLuc` chứ không đọc override thô: agent khai provider lệch thì
  // override đã bị bỏ qua lúc dựng client, nên lượt thật chạy trên provider
  // chung. Đọc thô ở đây sẽ thoát sớm vì tưởng đang chạy Anthropic, cache âm
  // không bao giờ được ghi, và reactive fallback đâm lại đường pixel MỖI lượt -
  // mỗi lượt tốn hai lần gọi model.
  const { provider, model } = modelHieuLuc(override);
  if (laGoiThangHang(provider)) return;
  noVisionUntil.set(`${base.baseUrl ?? ""}|${model}`, Date.now() + CACHE_TTL_MS);
  log.warn({ model }, "Ghi nhớ model không đọc được ảnh (provider từ chối bằng 4xx)");
}

/** Xóa cache (cả cache âm) - gọi khi đổi cấu hình provider/vision từ dashboard */
export function clearVisionDetectionCache(): void {
  cacheByBaseUrl.clear();
  noVisionUntil.clear();
}

/**
 * Phân loại khả năng đọc ảnh của model đang hiệu lực (override agent -> runtime
 * settings -> env, cùng thứ tự với resolveLanguageModel).
 */
export async function classifyModelVision(
  override?: ModelOverride,
  fetcher: ModelsFetcher = defaultFetcher,
): Promise<ModelVisionKind> {
  const { mode } = getVisionSettings();
  if (mode === "on") return "vision";
  if (mode === "off") return "no-vision";

  const base = getEffectiveLlmSettings();
  // Cùng lý do với markModelNoVision: phải là model THẬT SỰ chạy, không phải
  // model agent khai. Đọc thô thì agent khai `anthropic` sẽ được coi là đọc
  // được ảnh và bot đính pixel, trong khi lượt thật đi tới model router có thể mù.
  const { provider, model } = modelHieuLuc(override);

  if (laGoiThangHang(provider)) return "vision";

  // Bằng chứng thật (provider đã từ chối ảnh) thắng mọi suy đoán
  const negativeUntil = noVisionUntil.get(`${base.baseUrl ?? ""}|${model}`);
  if (negativeUntil && negativeUntil > Date.now()) return "no-vision";

  if (!base.baseUrl || !base.apiKey) return "unknown";

  const { visionByModel, comboIds } = await lookupFromRouter(base.baseUrl, base.apiKey, fetcher);
  const vision = visionByModel.get(model);
  if (vision === true) return "vision";
  if (vision === false) {
    log.info({ model }, "Router báo model không đọc được ảnh - bỏ ảnh khỏi request");
    return "no-vision";
  }
  if (comboIds.has(model)) return "combo";
  return "unknown";
}

/** true trừ khi biết chắc model KHÔNG đọc được ảnh - giữ hành vi lạc quan cũ */
export async function modelReadsImages(
  override?: ModelOverride,
  fetcher: ModelsFetcher = defaultFetcher,
): Promise<boolean> {
  return (await classifyModelVision(override, fetcher)) !== "no-vision";
}
