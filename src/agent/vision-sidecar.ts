import { defaultCaller, type SidecarCaller, type SidecarImage } from "./vision-sidecar-caller.js";
import { getVisionSettings, isSidecarConfigured } from "../config/runtime-vision-settings.js";
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
    const { text: description, truncated, tokenVao, tokenRa } = await call(settings.sidecar, image, DESCRIBE_PROMPT);
    if (!description) return null;
    // Mô tả cụt vẫn DÙNG được cho lượt này (có còn hơn không), nhưng TUYỆT ĐỐI
    // không cache: bản cụt sẽ sống mãi và mọi lượt sau đều đọc phải nó
    if (image.cacheKey && !truncated) {
      saveImageDescription(image.cacheKey, description, settings.sidecar.model);
    }
    if (truncated) {
      log.warn(
        { cacheKey: image.cacheKey, chars: description.length, tokenVao, tokenRa },
        "Mô tả ảnh bị cắt vì chạm trần token - dùng tạm, KHÔNG cache. Cân nhắc nâng DESCRIBE_MAX_TOKENS",
      );
    } else {
      log.info(
        { cacheKey: image.cacheKey, model: settings.sidecar.model, chars: description.length, tokenVao, tokenRa },
        "Sidecar đã mô tả ảnh",
      );
    }
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

/**
 * Hỏi sidecar MỘT CÂU CỤ THỂ về ảnh (tool read_image) - khác describeImage:
 * prompt là chính câu hỏi của agent, KHÔNG cache (mỗi câu mỗi khác, mô tả
 * chung đã có cache riêng). Ném lỗi để tool tự diễn giải cho model.
 */
export async function askAboutImage(
  image: SidecarImage,
  question: string,
  call: SidecarCaller = defaultCaller,
): Promise<string> {
  const settings = getVisionSettings();
  if (!isSidecarConfigured(settings)) {
    throw new Error("Chưa cấu hình đủ base URL + model + API key cho sidecar");
  }
  const prompt =
    "Trả lời câu hỏi sau về ảnh bằng tiếng Việt, chính xác theo những gì nhìn thấy, " +
    `không suy diễn thông tin không có trong ảnh: ${question}`;
  const { text: answer, truncated, tokenVao, tokenRa } = await call(settings.sidecar, image, prompt);
  log.info(
    { model: settings.sidecar.model, question: question.slice(0, 100), chars: answer.length, truncated, tokenVao, tokenRa },
    "Sidecar trả lời câu hỏi về ảnh",
  );
  // Câu trả lời không cache nên cụt chỉ hại lượt này - nói thật để model biết
  // phần sau còn thiếu, đừng kết luận chắc nịch từ dữ liệu dở dang
  return truncated ? `${answer}\n\n(Phần mô tả bị cắt vì quá dài - có thể còn chi tiết chưa liệt kê.)` : answer;
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
  const { text } = await call(
    settings.sidecar,
    { base64: TEST_PIXEL_PNG_BASE64, mediaType: "image/png" },
    DESCRIBE_PROMPT,
  );
  return text;
}
