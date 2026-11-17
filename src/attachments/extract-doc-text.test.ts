import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoiTep } from "./attachment-extract-types.js";
import { extractDocText } from "./extract-doc-text.js";
import { taoCfb, taoDocToiThieu } from "./fixtures/tao-cfb-thu-nghiem.js";

const laLoiTep = (ma: string) => (err: unknown) => err instanceof LoiTep && err.ma === ma;

describe("extractDocText - .doc Word 97-2003", () => {
  it("đọc đúng chữ tiếng Việt có dấu", async () => {
    const chu = await extractDocText(taoDocToiThieu("Bản kiểm điểm cá nhân năm 2026 - tiêu chí số 3"));
    assert.match(chu, /Bản kiểm điểm cá nhân năm 2026 - tiêu chí số 3/);
  });

  it("Office có mật khẩu (EncryptedPackage) -> mã mat-khau", async () => {
    const buf = taoCfb([
      { ten: "EncryptionInfo", data: Buffer.alloc(10) },
      { ten: "EncryptedPackage", data: Buffer.alloc(10) },
    ]).buf;
    await assert.rejects(extractDocText(buf), laLoiTep("mat-khau"));
  });

  it("Word 97 mã hóa RC4 (cờ fEncrypted trong FIB) -> mã mat-khau, không báo hỏng", async () => {
    const buf = taoDocToiThieu("bí mật");
    // FIB nằm đầu stream WordDocument; flags ở +0x0A, fEncrypted = 0x0100
    const viTriFib = buf.indexOf(Buffer.from([0xec, 0xa5]));
    buf.writeUInt16LE(buf.readUInt16LE(viTriFib + 0x0a) | 0x0100, viTriFib + 0x0a);
    await assert.rejects(extractDocText(buf), laLoiTep("mat-khau"));
  });

  it("CFB không phải Word (vd .xls cũ) -> mã chua-ho-tro", async () => {
    const buf = taoCfb([{ ten: "Workbook", data: Buffer.alloc(10) }]).buf;
    await assert.rejects(extractDocText(buf), laLoiTep("chua-ho-tro"));
  });

  it("CFB độc (shift 27) bị chặn ở bộ kiểm -> mã hong, không chạm word-extractor", async () => {
    const buf = taoDocToiThieu("x");
    buf.writeUInt16LE(27, 30);
    await assert.rejects(extractDocText(buf), laLoiTep("hong"));
  });

  it("FIB rác (magic sai) -> mã hong với câu tiếng Việt", async () => {
    const buf = taoCfb([
      { ten: "WordDocument", data: Buffer.alloc(100) },
      { ten: "1Table", data: Buffer.alloc(10) },
    ]).buf;
    await assert.rejects(extractDocText(buf), (err: unknown) => laLoiTep("hong")(err) && /Word/.test((err as Error).message));
  });
});
