/**
 * Chọn CỠ ảnh trong payload Zalo trước khi đưa vào context model.
 *
 * Zalo gửi kèm nhiều biến thể của cùng một ảnh (hd / href / oriUrl /
 * normalUrl / thumb). Trước đây code lấy `hd` đầu tiên, tức bản to nhất: ảnh
 * vé số thật đo được 977x2128 px, tốn ~2500 token MỖI LẦN vào context. Một
 * lượt agent 5 step x 4 ảnh (1 ảnh mới + 3 ảnh nạp lại từ history) = 20 lượt
 * ảnh, chiếm ~80% hoá đơn token của lượt đó.
 *
 * Zalo đã resize sẵn ở phía họ nên chỉ cần đổi thứ tự ưu tiên - không cần
 * thư viện resize (sharp cần build native trên Windows, jimp thì nặng).
 *
 * Module thuần, không import env - caller truyền quality vào để test dễ.
 */

export type ImageQuality = "thumb" | "normal" | "hd";

/** Các key ảnh trong content của tin nhắn Zalo, xếp từ nhỏ tới lớn */
type VariantKey = "thumb" | "normalUrl" | "href" | "oriUrl" | "hd";

/**
 * Thứ tự thử theo từng mức chất lượng. Luôn có đủ đường lui tới hết danh sách
 * vì payload Zalo không phải lúc nào cũng có đủ mọi biến thể.
 *
 * - normal (mặc định): đủ nét để đọc chữ số trên vé/hoá đơn, rẻ hơn hd nhiều
 * - hd: giữ hành vi cũ, chỉ nên bật khi cần đọc chi tiết rất nhỏ
 * - thumb: rẻ nhất nhưng thường mất chữ số - chỉ hợp khi chỉ cần "ảnh này là gì"
 */
const PREFERENCE: Record<ImageQuality, VariantKey[]> = {
  thumb: ["thumb", "normalUrl", "href", "oriUrl", "hd"],
  normal: ["normalUrl", "href", "oriUrl", "hd", "thumb"],
  hd: ["hd", "oriUrl", "href", "normalUrl", "thumb"],
};

export type PickedImage = { url: string; variant: VariantKey };

/**
 * Chọn URL ảnh theo mức chất lượng mong muốn. Trả null nếu content không có
 * biến thể nào dùng được.
 */
export function pickImageVariant(
  content: Record<string, unknown>,
  quality: ImageQuality,
): PickedImage | null {
  for (const key of PREFERENCE[quality]) {
    const value = content[key];
    if (typeof value === "string" && value.trim().startsWith("http")) {
      return { url: value.trim(), variant: key };
    }
  }
  return null;
}

/**
 * Ước lượng token của 1 ảnh theo kích thước pixel. Công thức (w*h)/750 của
 * Anthropic - các họ model khác tính theo ô 512px nhưng cùng bậc độ lớn, đủ
 * để log ra và so sánh trước/sau khi đổi cỡ ảnh.
 */
export function estimateImageTokens(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  return Math.round((width * height) / 750);
}

/**
 * Đọc kích thước JPEG/PNG từ vài byte đầu - chỉ để log, không giải mã ảnh.
 * Không nhận dạng được thì trả null (log bỏ qua, không làm chết lượt).
 */
export function readImageSize(data: Buffer): { width: number; height: number } | null {
  // PNG: signature 8 byte, IHDR width/height là 2 số 32-bit big-endian
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }

  // JPEG: quét tới marker SOF (0xC0-0xCF, trừ DHT/JPG/DAC) để lấy kích thước
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = data[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      const segmentLength = data.readUInt16BE(offset + 2);
      if (segmentLength < 2) return null; // segment hỏng - dừng thay vì lặp vô hạn
      offset += 2 + segmentLength;
    }
  }

  return null;
}
