import assert from "node:assert/strict";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import { readZipEntry } from "./read-zip-entry.js";

/**
 * `readZipEntry`/`readZipEntryText` là module THUẦN (không chạm env/DB) - dựng
 * zip tay bằng zlib built-in thay vì phụ thuộc `render-docx.ts`, để test file
 * này không kéo theo bất kỳ import nào khác.
 *
 * Cấu trúc zip tối thiểu: local file header (30 byte) + tên + dữ liệu nén, rồi
 * central directory header (46 byte) + tên, rồi End Of Central Directory (22
 * byte). Offset từng trường phải khớp CHÍNH XÁC với những gì `read-zip-entry.ts`
 * đọc - lệch một trường là `centralEntries`/`readZipEntry` đọc sai âm thầm.
 */
function buildZip(entryName: string, data: Buffer): Buffer {
  const compressed = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(entryName, "utf-8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
  localHeader.writeUInt16LE(8, 8); // method = deflate
  localHeader.writeUInt32LE(compressed.length, 18); // compressed size
  localHeader.writeUInt32LE(data.length, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26); // name length
  localHeader.writeUInt16LE(0, 28); // extra length
  const localSection = Buffer.concat([localHeader, nameBuf, compressed]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
  centralHeader.writeUInt16LE(8, 10); // method = deflate
  centralHeader.writeUInt32LE(compressed.length, 20); // compressed size
  centralHeader.writeUInt32LE(data.length, 24); // uncompressed size
  centralHeader.writeUInt16LE(nameBuf.length, 28); // name length
  centralHeader.writeUInt32LE(0, 42); // local header offset (entry duy nhất, ở đầu buffer)
  const centralSection = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(1, 10); // tổng số entry
  eocd.writeUInt32LE(centralSection.length, 12); // kích thước central directory
  eocd.writeUInt32LE(localSection.length, 16); // offset central directory

  return Buffer.concat([localSection, centralSection, eocd]);
}

describe("readZipEntry - trần dung lượng giải nén (chặn zip bomb)", () => {
  it("entry nén bình thường vẫn đọc đúng khi dưới trần", () => {
    const goc = Buffer.from("Bảo hành 12 tháng cho mọi sản phẩm.".repeat(50), "utf-8");
    const zip = buildZip("noi_dung.txt", goc);

    const ra = readZipEntry(zip, "noi_dung.txt", 1_000_000);
    assert.deepEqual(ra, goc);
  });

  it("entry giải nén vượt trần ném lỗi tiếng Việt đọc được, không phải lỗi zlib thô", () => {
    // Dữ liệu lặp một byte nén cực tốt (deflate ratio cao) - đủ để giải nén ra
    // lớn hơn nhiều trần nhỏ đặt cho test, không cần dựng bomb thật hàng GB.
    const goc = Buffer.alloc(200_000, 0x41); // 200KB toàn 'A'
    const zip = buildZip("bomb.bin", goc);

    assert.throws(
      () => readZipEntry(zip, "bomb.bin", 1_000), // trần 1000 byte, nhỏ hơn hẳn 200_000
      (err: unknown) => {
        assert.ok(err instanceof Error, "phải là Error");
        assert.match((err as Error).message, /vượt quá giới hạn an toàn/, "câu tiếng Việt đọc được");
        assert.match((err as Error).message, /zip bomb/i);
        assert.doesNotMatch(
          (err as Error).message,
          /Cannot create a Buffer/i,
          "không được lộ nguyên văn lỗi thư viện zlib",
        );
        return true;
      },
    );
  });

  it("entry không tồn tại vẫn trả null như cũ, không bị ảnh hưởng bởi tham số trần mới", () => {
    const zip = buildZip("co-that.txt", Buffer.from("x"));
    assert.equal(readZipEntry(zip, "khong-ton-tai.txt"), null);
  });
});
