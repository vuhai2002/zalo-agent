import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import {
  getVisionSettings,
  isSidecarConfigured,
  type VisionSidecarSettings,
} from "../config/runtime-vision-settings.js";
import {
  getImageDescription,
  saveImageDescription,
} from "../conversation/image-description-store.js";
import { createLogger } from "../shared/logger.js";

/**
 * "Mắt thuê" cho model chính không đọc được ảnh: gọi model vision phụ (thường
 * Gemini free qua endpoint OpenAI-compatible) mô tả ảnh thành text MỘT lần,
 * cache vào DB - model chính và mọi lượt sau chỉ đọc text.
 *
 * Học text-mode của Hermes (agent/image_routing.py): mô tả ngay lúc dùng, cache
 * theo ảnh, prompt ép chép nguyên văn chữ + số vì use case chính của bot là đọc
 * vé số/hóa đơn/chứng từ - mô tả chung chung là vô dụng với việc dính tiền.
 */

const log = createLogger("vision-sidecar");

/** Prompt cố định - đổi là mô tả cache cũ vẫn dùng được nên không cần version */
const DESCRIBE_PROMPT =
  "Mô tả chi tiết ảnh này bằng tiếng Việt cho một AI khác không xem được ảnh. " +
  "BẮT BUỘC: chép NGUYÊN VĂN mọi chữ và con số nhìn thấy trong ảnh (số vé, mã, " +
  "ngày tháng, tên, giá tiền, biển số...), tách phần chữ và phần số đúng như in. " +
  "Sau đó tả bố cục, vật thể, người, màu sắc. Không suy diễn thông tin không có trong ảnh.";

const DESCRIBE_MAX_TOKENS = 1024;

export type SidecarImage = {
  base64: string;
  mediaType: string;
  /** Đường dẫn media làm khóa cache; không có (ảnh chưa persist được) thì mô tả không cache */
  cacheKey?: string;
};

export type SidecarCaller = (
  settings: VisionSidecarSettings,
  image: SidecarImage,
) => Promise<string>;

/** Đường gọi thật - tách ra để test tiêm caller giả, không chạm mạng */
const defaultCaller: SidecarCaller = async (settings, image) => {
  const provider = createOpenAICompatible({
    name: "vision-sidecar",
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
  });
  const result = await generateText({
    model: provider(settings.model),
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: image.base64, mediaType: image.mediaType },
          { type: "text", text: DESCRIBE_PROMPT },
        ],
      },
    ],
    maxOutputTokens: DESCRIBE_MAX_TOKENS,
    maxRetries: 1,
  });
  return result.text.trim();
};

/**
 * Mô tả 1 ảnh, ưu tiên cache. Lỗi (sidecar chết, hết quota, ảnh hỏng) trả null -
 * caller tự quyết nói gì với model chính; KHÔNG throw để một ảnh hỏng không
 * giết cả lượt trả lời.
 */
export async function describeImage(
  image: SidecarImage,
  call: SidecarCaller = defaultCaller,
): Promise<string | null> {
  if (image.cacheKey) {
    const cached = getImageDescription(image.cacheKey);
    if (cached) return cached;
  }

  const settings = getVisionSettings();
  if (!isSidecarConfigured(settings)) return null;

  try {
    const description = await call(settings.sidecar, image);
    if (!description) return null;
    if (image.cacheKey) {
      saveImageDescription(image.cacheKey, description, settings.sidecar.model);
    }
    log.info(
      { cacheKey: image.cacheKey, model: settings.sidecar.model, chars: description.length },
      "Sidecar đã mô tả ảnh",
    );
    return description;
  } catch (err) {
    log.warn({ cacheKey: image.cacheKey, err }, "Sidecar mô tả ảnh thất bại - bỏ qua ảnh này");
    return null;
  }
}

/**
 * Mô tả trước (và cache) các ảnh đã lưu trong data/media - dùng cho ảnh history
 * sắp được nạp lại vào context. Ảnh load không được (file đã dọn) bỏ qua êm.
 */
export async function ensureDescriptionsFor(
  relPaths: string[],
  loadImage: (relPath: string) => { base64: string; mediaType: string } | null,
  call: SidecarCaller = defaultCaller,
): Promise<void> {
  for (const relPath of relPaths) {
    if (getImageDescription(relPath)) continue;
    const stored = loadImage(relPath);
    if (!stored) continue;
    await describeImage({ ...stored, cacheKey: relPath }, call);
  }
}

/** 1x1 PNG trắng - đủ để nút "Test sidecar" chứng minh đường vision chạy thật */
const TEST_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Gọi sidecar với ảnh test tí hon - trả lỗi nguyên văn cho UI hiển thị */
export async function testSidecar(call: SidecarCaller = defaultCaller): Promise<string> {
  const settings = getVisionSettings();
  if (!isSidecarConfigured(settings)) {
    throw new Error("Chưa cấu hình đủ base URL + model + API key cho sidecar");
  }
  return call(settings.sidecar, { base64: TEST_PIXEL_PNG_BASE64, mediaType: "image/png" });
}
