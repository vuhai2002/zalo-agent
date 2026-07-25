const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type DownloadedImage = { data: Buffer; mediaType: string };

/** Tải ảnh về buffer, chặn ảnh quá 8MB (vision không cần lớn hơn). Lỗi gì cũng trả null. */
export async function downloadImage(url: string): Promise<DownloadedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mediaType = res.headers.get("content-type") ?? "image/jpeg";
    const data = Buffer.from(await res.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) return null;
    return { data, mediaType };
  } catch {
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
