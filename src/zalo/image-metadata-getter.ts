import fs from "node:fs";
import type { ImageMetadataGetter } from "zca-js";
import { imageSize } from "image-size";

/**
 * Định dạng mà zca-js gọi getter này cho (`uploadAttachment` nhánh jpg/png/webp,
 * `getGifMetaData` cho gif). Nhận diện bằng MAGIC BYTE chứ không bằng đuôi file:
 * đuôi lấy từ URL người lạ gửi (`send_file`), còn `imageSize` chọn parser theo
 * BYTE - nên `https://x/a.jpg` trả về byte ICNS vẫn đi thẳng vào parser ICNS.
 */
export function laDinhDangAnhChoPhep(buf: Buffer): boolean {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return true;
  if (buf.length >= 6) {
    const dau = buf.toString("latin1", 0, 6);
    if (dau === "GIF87a" || dau === "GIF89a") return true;
  }
  return buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
}

/**
 * zca-js v2 bỏ sharp - phải tự cung cấp hàm đọc metadata ảnh khi gửi ảnh.
 *
 * Cổng magic byte đứng TRƯỚC `imageSize` là lưới chặn có chủ đích: image-size
 * 2.0.2 lặp VÔ HẠN trên ICNS/JXL/HEIF dựng khéo (GHSA-w3rx-r6r6-pgpr,
 * GHSA-5p2g-fcmc-qvqq) - vòng lặp đồng bộ đóng băng event loop, đơ cả process
 * (mọi account), `try/catch` không cứu được. Bản 2.0.4 đã vá, nhưng chỉ cho
 * parser của 4 định dạng thật sự cần chạm tới thì lỗi kế tiếp trong mấy chục
 * parser còn lại cũng không với tới được.
 */
export const imageMetadataGetter: ImageMetadataGetter = async (filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    if (!laDinhDangAnhChoPhep(buffer)) return null;
    const { width, height } = imageSize(buffer);
    if (!width || !height) return null;
    return { width, height, size: buffer.byteLength };
  } catch {
    return null;
  }
};
