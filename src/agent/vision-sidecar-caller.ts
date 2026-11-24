import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { chayStream } from "./stream-text-result.js";
import type { VisionSidecarSettings } from "../config/runtime-vision-settings.js";

/**
 * Đường gọi THẬT tới model vision phụ (sidecar): mô tả ảnh, trả lời câu hỏi về
 * ảnh, chép chữ trang PDF quét. Tách khỏi `vision-sidecar.ts` để test tiêm
 * `fetch` giả mà vẫn đi qua provider + `streamText` thật.
 */

/**
 * Trần token cho một lượt mô tả ảnh. 1024 (số cũ) đủ cho ảnh thường nhưng
 * KHÔNG đủ với ảnh nhiều chữ - menu, bảng giá, danh sách, ảnh chụp màn hình -
 * vì prompt bắt chép nguyên văn mọi chữ và số. Tiếng Việt có dấu ~2.7 ký tự
 * mỗi token nên 2048 tương đương ~5.500 ký tự mô tả, đủ cho ảnh dày chữ.
 */
export const DESCRIBE_MAX_TOKENS = 2048;

export type SidecarImage = {
  base64: string;
  mediaType: string;
  /** Đường dẫn media làm khóa cache; không có (ảnh chưa persist được) thì mô tả không cache */
  cacheKey?: string;
};

/**
 * Kết quả một lượt gọi sidecar. `truncated` là thứ bắt buộc phải có: mô tả bị
 * cắt giữa chừng mà đem cache thì bản cụt sống VĨNH VIỄN, mọi lượt sau đều đọc
 * nó và không ai biết vì sao bot trả lời thiếu.
 *
 * `tokenVao`/`tokenRa` chỉ để GHI LOG chi phí - sidecar là model riêng, khác
 * giá model chính nên không cộng vào `agent_turns`. Nhà cung cấp không trả thì
 * để trống, không hỏng lời gọi.
 */
export type SidecarResult = { text: string; truncated: boolean; tokenVao?: number; tokenRa?: number };

export type SidecarCaller = (
  settings: VisionSidecarSettings,
  image: SidecarImage,
  prompt: string,
  /** Mặc định trần mô tả ảnh; OCR trang tài liệu truyền trần riêng, lớn hơn */
  maxOutputTokens?: number,
  abortSignal?: AbortSignal,
) => Promise<SidecarResult>;

/** `fetch` tiêm vào chỉ dành cho test; chạy thật để trống (fetch toàn cục) */
export function taoSidecarCaller(fetchImpl?: typeof fetch): SidecarCaller {
  return async (settings, image, prompt, maxOutputTokens = DESCRIBE_MAX_TOKENS, abortSignal) => {
    const provider = createOpenAICompatible({
      name: "vision-sidecar",
      baseURL: settings.baseUrl,
      apiKey: settings.apiKey,
      // Không bật thì endpoint OpenAI-compatible KHÔNG trả usage khi stream
      // (đo thật: totalUsage rỗng) - chi phí OCR/mô tả ảnh thành vô hình
      includeUsage: true,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    // Streaming như mọi lời gọi LLM khác trong dự án. Sidecar hiện trỏ thẳng
    // Gemini nên không dính 524 của Cloudflare, NHƯNG base URL là thứ chỉnh được
    // từ dashboard - trỏ nó về router là dính ngay. Giữ một bất biến "không còn
    // lời gọi LLM non-stream nào" rẻ hơn việc nhớ chỗ nào đang được miễn và vì sao.
    const result = await chayStream((onError) =>
      streamText({
        model: provider(settings.model),
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: image.base64, mediaType: image.mediaType },
              { type: "text", text: prompt },
            ],
          },
        ],
        maxOutputTokens,
        abortSignal,
        maxRetries: 1,
        onError,
      }),
    );
    const usage = result.totalUsage as { inputTokens?: number; outputTokens?: number };
    // finishReason "length" = model đang viết dở thì chạm trần token
    return {
      text: result.text.trim(),
      truncated: result.finishReason === "length",
      ...(usage.inputTokens !== undefined ? { tokenVao: usage.inputTokens } : {}),
      ...(usage.outputTokens !== undefined ? { tokenRa: usage.outputTokens } : {}),
    };
  };
}

/** Đường gọi thật - các hàm nhận `call` để test tiêm caller giả, không chạm mạng */
export const defaultCaller: SidecarCaller = taoSidecarCaller();
