import { getImageSettings, isImageGenConfigured, type ImageGenSettings } from "../config/runtime-image-settings.js";
import { readImageFromSseStream } from "./read-image-sse-stream.js";
import { LoiVeHutAnh } from "./image-retry-policy.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

/**
 * Gọi endpoint OpenAI-compatible `/v1/images/generations` để vẽ hoặc SỬA ảnh.
 *
 * Ba quyết định đến từ đo thật trên 9Router (cx/gpt-5.5-image), không phải suy đoán:
 *
 * 1. XIN SSE bằng header `Accept: text/event-stream`, KHÔNG dùng
 *    `?response_format=binary`. Binary nhẹ hơn thật (157KB so với 2.4MB base64)
 *    nhưng nó chỉ trả byte đầu tiên LÚC VẼ XONG, mà router nằm sau Cloudflare -
 *    vẽ lâu là ăn HTTP 524 "origin timeout". Đo cùng prompt chạy song song:
 *    binary byte đầu sau 125.4s -> 524; SSE byte đầu sau 1.8s -> 200 ở giây 62.7.
 *    Đổi lại tốn ~2.5 lần băng thông (base64 + event tiến độ) - đáng, vì đường
 *    kia có lúc không ra được ảnh nào.
 * 2. KHÔNG gửi `size`. Model bỏ qua tham số này: xin 1024x1024 hai lần nhận về
 *    1024x1536 rồi 1536x1024. Muốn dọc/ngang phải nói trong prompt.
 * 3. Ảnh gốc nằm ở trường `image` (không phải `ref_image`), dạng data URI. Sai
 *    tên trường thì provider bỏ qua âm thầm - vẫn ra ảnh nhưng là ảnh vẽ mới.
 *
 * Vẫn đọc được JSON thường và bytes thô: chỉ provider codex mới stream, endpoint
 * khác nhận header Accept rồi trả JSON như cũ.
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

export type ImageExt = "jpg" | "png" | "webp";

export type GeneratedImage = {
  data: Buffer;
  ext: ImageExt;
};

const EXT_BY_MIME: Record<string, ImageExt> = {
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
    // Không gửi thì nhà cung cấp tự chọn mức thấp hơn. Đo A/B cùng prompt:
    // "high" ra ảnh giàu chi tiết hơn hẳn mà không chậm hơn.
    quality: getTuning("IMAGE_GEN_QUALITY"),
  };
  if (params.transparentBackground) body.background = "transparent";
  if (params.refImage) {
    body.image = `data:${params.refImage.mediaType};base64,${params.refImage.base64}`;
    // Đọc kỹ ảnh gốc thì mới giữ đúng chi tiết khi sửa
    body.image_detail = "high";
  }

  const url = `${settings.baseUrl.replace(/\/+$/, "")}/v1/images/generations`;
  // Đuôi file theo format đã XIN: stream SSE và JSON chỉ mang base64 trần, không
  // kèm MIME. Riêng nhánh bytes thô thì Content-Type thật mới là nguồn đúng.
  const requestedExt: ImageExt = outputFormat === "png" ? "png" : "jpg";

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
        // Header quyết định: router chỉ stream khi thấy dòng này. Không có nó
        // thì kết nối im lặng tới lúc vẽ xong và Cloudflare cắt bằng 524.
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      // fetch không có timeout mặc định - thiếu dòng này thì provider treo là
      // treo luôn cả lượt agent, người dùng đợi vô hạn. Signal này phủ CẢ phần
      // đọc stream chứ không riêng lúc mở kết nối.
      signal: AbortSignal.timeout(getTuning("IMAGE_GEN_TIMEOUT_MS")),
    });

    if (!response.ok) throw new Error(await readErrorMessage(response));
    return await readImageResponse(response, requestedExt);
  } catch (err) {
    // Bọc CẢ lượt gọi lẫn lượt đọc stream: với SSE, fetch trả về sau vài giây
    // rồi mình còn đọc thêm cả phút - quá hạn giữa chừng là ca dễ xảy ra nhất,
    // mà bọc mỗi fetch thì nó lọt ra ngoài dạng "This operation was aborted".
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(`Vẽ ảnh quá lâu (hơn ${Math.round(getTuning("IMAGE_GEN_TIMEOUT_MS") / 1000)} giây) nên đã dừng`);
    }
    throw err;
  }
}

/** Đọc ảnh ra khỏi response, chịu được cả 3 kiểu provider có thể trả về */
async function readImageResponse(response: Response, requestedExt: ImageExt): Promise<GeneratedImage> {
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();

  if (contentType === "text/event-stream") {
    return { data: Buffer.from(await readImageFromSseStream(response), "base64"), ext: requestedExt };
  }

  if (contentType === "application/json") {
    const parsed = (await response.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
    const b64 = parsed?.data?.[0]?.b64_json;
    // Cùng lớp với nhánh SSE: chạy xong mà không ra ảnh -> đáng thử lại. Nhánh
    // Content-Type lạ bên dưới thì KHÔNG: đó là trang lỗi hạ tầng, không phải
    // model đổi ý.
    if (!b64) throw new LoiVeHutAnh("Provider không trả về ảnh (JSON thiếu b64_json)");
    return { data: Buffer.from(b64, "base64"), ext: requestedExt };
  }

  const ext = EXT_BY_MIME[contentType];
  if (!ext) {
    // Trang lỗi HTML của proxy chẳng hạn - đừng ghi ra file .jpg rồi gửi cho
    // người dùng một file hỏng
    throw new Error(`Provider không trả về ảnh (Content-Type: ${contentType || "trống"})`);
  }
  return { data: Buffer.from(await response.arrayBuffer()), ext };
}
