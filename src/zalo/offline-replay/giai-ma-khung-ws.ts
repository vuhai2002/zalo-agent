import crypto from "node:crypto";
import zlib from "node:zlib";

/**
 * Giải mã một khung WebSocket Zalo: 4 byte đầu (phiên bản, số lệnh, lệnh con),
 * sau đó JSON `{ data, encrypt }`. Cùng thuật toán `decodeEventData` của zca-js
 * (`src/utils.ts`), viết lại đồng bộ vì zca-js không export hàm đó:
 * - encrypt 0: `data` là JSON trơn;
 * - encrypt 1: base64, nén;
 * - encrypt 2: base64 (đã URL-encode), AES-GCM (iv 16 byte, aad 16 byte, tag 16
 *   byte cuối) bằng `cipherKey` của phiên, rồi nén;
 * - encrypt 3: như 2 nhưng không nén.
 * `zlib.unzipSync` tự nhận cả gzip lẫn zlib (zca-js dùng `pako.inflate`).
 *
 * Hỏng ở bất cứ bước nào (JSON, khóa sai/thiếu, dữ liệu cụt) -> `null`, không
 * ném: chạy trong handler `message` của WebSocket, ném ra là đụng listener.
 */
export function giaiMaKhungWs(frame: Buffer, cipherKey: string | null): Record<string, unknown> | null {
  try {
    const goi = JSON.parse(frame.subarray(4).toString("utf8")) as { data?: unknown; encrypt?: unknown };
    if (typeof goi.data !== "string" || typeof goi.encrypt !== "number") return null;
    const kieu = goi.encrypt;
    if (kieu === 0) return laObject(JSON.parse(goi.data));
    if (kieu !== 1 && kieu !== 2 && kieu !== 3) return null;

    let buf = Buffer.from(kieu === 1 ? goi.data : decodeURIComponent(goi.data), "base64");
    if (kieu !== 1) {
      if (!cipherKey || buf.length < 48) return null;
      const khoa = Buffer.from(cipherKey, "base64");
      const decipher = crypto.createDecipheriv(
        `aes-${khoa.length * 8}-gcm` as crypto.CipherGCMTypes,
        khoa,
        buf.subarray(0, 16),
      );
      decipher.setAAD(buf.subarray(16, 32));
      const than = buf.subarray(32);
      decipher.setAuthTag(than.subarray(than.length - 16));
      buf = Buffer.concat([decipher.update(than.subarray(0, than.length - 16)), decipher.final()]);
    }
    const chu = (kieu === 3 ? buf : zlib.unzipSync(buf)).toString("utf8");
    return chu ? laObject(JSON.parse(chu)) : null;
  } catch {
    return null;
  }
}

function laObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
