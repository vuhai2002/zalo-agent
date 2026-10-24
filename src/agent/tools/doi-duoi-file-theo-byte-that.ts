import path from "node:path";
import { laDinhDangAnhChoPhep } from "../../zalo/image-metadata-getter.js";

/**
 * Đuôi mà zca-js `uploadAttachment` đưa vào nhánh ẢNH (đọc cỡ qua
 * `imageMetadataGetter`). Nhánh này quyết theo ĐUÔI TÊN FILE, không theo byte.
 */
const DUOI_NHANH_ANH = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

/** Brand `ftyp` của họ HEIF (ISO/IEC 23008-12) - AVIF và HEIC đều là HEIF */
const BRAND_AVIF = new Set(["avif", "avis"]);
const BRAND_HEIC = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** Đoán đuôi thật từ vài byte đầu - chỉ những định dạng ảnh hay đội lốt `.jpg` */
function duoiThat(data: Buffer): string {
  if (data.length >= 12 && data.toString("latin1", 4, 8) === "ftyp") {
    const brand = data.toString("latin1", 8, 12);
    if (BRAND_AVIF.has(brand)) return "avif";
    if (BRAND_HEIC.has(brand)) return "heic";
  }
  if (data.length >= 2 && data.toString("latin1", 0, 2) === "BM") return "bmp";
  if (data.length >= 4) {
    const dau = data.toString("latin1", 0, 4);
    if (dau === "II*\0" || dau === "MM\0*") return "tif";
  }
  // Không nhận ra: KHÔNG đoán thành `.mp4` hay đuôi nào zca-js có nhánh riêng
  // (mp4 đi đường upload video chờ websocket) - `.bin` luôn là file thường.
  return "bin";
}

/**
 * Tên file cho `send_file` khớp với BYTE THẬT, để zca-js chọn đúng nhánh gửi.
 *
 * Vì sao: link `.jpg` của CDN tự đổi định dạng có thể trả AVIF/HEIC. Giữ đuôi
 * `.jpg` thì zca-js đi nhánh ảnh, cổng magic byte (`image-metadata-getter.ts`,
 * chặn lỗi image-size làm treo bot) trả rỗng, zca-js ném "Failed to get image
 * metadata" và người nhận không được gì. Đổi đuôi theo byte thật thì nó đi
 * nhánh file thường: người nhận vẫn nhận được file, chỉ là không hiện như ảnh.
 *
 * Chỉ đụng tới file mang đuôi ảnh mà byte KHÔNG phải ảnh đọc được - pdf, docx,
 * hay ảnh JPEG/PNG/GIF/WebP thật giữ nguyên tên.
 */
export function doiDuoiTheoByteThat(tenFile: string, data: Buffer): string {
  const ext = path.extname(tenFile).slice(1).toLowerCase();
  if (!DUOI_NHANH_ANH.has(ext) || laDinhDangAnhChoPhep(data)) return tenFile;
  return `${tenFile.slice(0, tenFile.length - ext.length)}${duoiThat(data)}`;
}
