import { env } from "../config/env.js";
import { getImageSettings, isImageGenConfigured, type ImageGenSettings } from "../config/runtime-image-settings.js";

/**
 * Gọi endpoint OpenAI-compatible `/v1/images/generations` để vẽ hoặc SỬA ảnh.
 *
 * Ba quyết định đến từ đo thật trên 9Router (cx/gpt-5.5-image), không phải suy đoán:
 *
 * 1. Luôn thêm `?response_format=binary`. Đường JSON mặc định trả base64 trong
 *    chuỗi 3.3MB rồi phải decode; đường binary trả thẳng bytes. Cùng một ảnh:
 *    JPEG binary 157KB, PNG base64 2.4MB - nhẹ hơn 15 lần.
 * 2. KHÔNG gửi `size`. Model bỏ qua tham số này: xin 1024x1024 hai lần nhận về
 *    1024x1536 rồi 1536x1024. Muốn dọc/ngang phải nói trong prompt.
 * 3. Ảnh gốc nằm ở trường `image` (không phải `ref_image`), dạng data URI. Sai
 *    tên trường thì provider bỏ qua âm thầm - vẫn ra ảnh nhưng là ảnh vẽ mới.
 *
 * `fetchImpl` tiêm được để test không chạm mạng - cùng nếp với SidecarCaller.
 */

export type GenerateImageParams = {
  prompt: string;
  /** Ảnh gốc để sửa, lấy từ media-store (loadStoredImage) */
  refImage?: { base64: string; mediaType: string };
  /** Cần nền trong suốt (logo, sticker) - ép sang PNG vì JPEG không có alpha */
  transparentBackground?: boolean;
};

export type GeneratedImage = {
  data: Buffer;
  /** Đuôi file theo Content-Type thật của response, không theo cái mình xin */
  ext: "jpg" | "png" | "webp";
};

const EXT_BY_MIME: Record<string, GeneratedImage["ext"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Lấy câu lỗi từ body. Router trả HAI dạng khác nhau tùy mã lỗi (đo thật):
 *   400 -> {"error":{"message":"..."}}   error là OBJECT
 *   401 -> {"error":"API key required"}  error là CHUỖI
 * Chỉ đọc `error.message` thì sai key sẽ hiện "undefined" cho người dùng.
 */
async function readErrorMessage(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    const err = parsed.error;
    if (typeof err === "string" && err) return err;
    if (err && typeof err === "object") {
      const message = (err as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  } catch {
    // Không phải JSON (HTML của proxy, body rỗng) - rơi xuống dùng mã HTTP
  }
  return `HTTP ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`;
}

export async function generateImage(
  params: GenerateImageParams,
  settings: ImageGenSettings = getImageSettings(),
  fetchImpl: typeof fetch = fetch,
): Promise<GeneratedImage> {
  if (!isImageGenConfigured(settings)) {
    throw new Error("Tool vẽ ảnh chưa cấu hình đủ base URL + model + API key");
  }

  // Nền trong suốt bắt buộc PNG - JPEG không có kênh alpha nên nền sẽ ra đen
  const outputFormat = params.transparentBackground ? "png" : "jpeg";

  const body: Record<string, unknown> = {
    model: settings.model,
    prompt: params.prompt,
    n: 1,
    output_format: outputFormat,
  };
  if (params.transparentBackground) body.background = "transparent";
  if (params.refImage) {
    body.image = `data:${params.refImage.mediaType};base64,${params.refImage.base64}`;
    // Đọc kỹ ảnh gốc thì mới giữ đúng chi tiết khi sửa
    body.image_detail = "high";
  }

  const url = `${settings.baseUrl.replace(/\/+$/, "")}/v1/images/generations?response_format=binary`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify(body),
      // fetch không có timeout mặc định - thiếu dòng này thì provider treo là
      // treo luôn cả lượt agent, người dùng đợi vô hạn
      signal: AbortSignal.timeout(env.IMAGE_GEN_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(`Vẽ ảnh quá lâu (hơn ${Math.round(env.IMAGE_GEN_TIMEOUT_MS / 1000)} giây) nên đã dừng`);
    }
    throw err;
  }

  if (!response.ok) throw new Error(await readErrorMessage(response));

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = EXT_BY_MIME[contentType];
  if (!ext) {
    // Router không hỗ trợ response_format=binary thì nó trả JSON 200. Đừng ghi
    // JSON ra file .jpg rồi gửi cho người dùng một file hỏng.
    throw new Error(`Provider không trả về ảnh (Content-Type: ${contentType || "trống"})`);
  }

  return { data: Buffer.from(await response.arrayBuffer()), ext };
}
