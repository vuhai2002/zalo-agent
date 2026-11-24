import crypto from "node:crypto";
import zlib from "node:zlib";

/**
 * Dựng khung WebSocket Zalo GIẢ cho test, theo đúng định dạng bộ giải mã đọc:
 * byte 0 phiên bản (1), byte 1-2 số lệnh (little-endian), byte 3 lệnh con, rồi
 * JSON `{ data, encrypt }`. Chỉ dùng trong test.
 */
export const KHOA_TEST = crypto.createHash("sha256").update("khoa-thu").digest().toString("base64");

export function dungKhungWs(
  cmd: number,
  subCmd: number,
  duLieu: unknown,
  encrypt: 0 | 1 | 2 | 3 = 0,
  cipherKey: string = KHOA_TEST,
): Buffer {
  const json = JSON.stringify(duLieu);
  let data: string;
  if (encrypt === 0) {
    data = json;
  } else {
    const ban = encrypt === 3 ? Buffer.from(json, "utf8") : zlib.gzipSync(Buffer.from(json, "utf8"));
    if (encrypt === 1) {
      data = ban.toString("base64");
    } else {
      const iv = crypto.randomBytes(16);
      const aad = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(cipherKey, "base64"), iv);
      cipher.setAAD(aad);
      const than = Buffer.concat([cipher.update(ban), cipher.final(), cipher.getAuthTag()]);
      data = encodeURIComponent(Buffer.concat([iv, aad, than]).toString("base64"));
    }
  }
  const dau = Buffer.alloc(4);
  dau[0] = 1;
  dau.writeUInt16LE(cmd, 1);
  dau[3] = subCmd;
  return Buffer.concat([dau, Buffer.from(JSON.stringify({ data, encrypt }), "utf8")]);
}
