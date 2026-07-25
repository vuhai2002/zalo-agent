import { createLogger } from "./logger.js";
import { downloadFromPublicUrl } from "./safe-remote-download.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const log = createLogger("download-image");

export type DownloadedImage = { data: Buffer; mediaType: string };

/**
 * Tải ảnh về buffer, cắt theo stream khi vượt 8MB (vision không cần lớn hơn) và
 * chỉ nhận IP public. Lỗi gì cũng trả null - ảnh hỏng không được chặn đường trả
 * lời - nhưng vẫn log debug để không mất dấu hoàn toàn.
 */
export async function downloadImage(url: string): Promise<DownloadedImage | null> {
  try {
    const file = await downloadFromPublicUrl(url, { maxBytes: MAX_IMAGE_BYTES });
    // Zalo CDN đôi khi không trả content-type ảnh; vision cần media type image/*
    const mediaType = file.mediaType.startsWith("image/") ? file.mediaType : "image/jpeg";
    return { data: file.data, mediaType };
  } catch (err) {
    log.debug({ err }, "Không tải được ảnh");
    return null;
  }
}

export async function downloadImageAsBase64(
  url: string,
): Promise<{ base64: string; mediaType: string } | null> {
  const downloaded = await downloadImage(url);
  if (!downloaded) return null;
  return { base64: downloaded.data.toString("base64"), mediaType: downloaded.mediaType };
}
