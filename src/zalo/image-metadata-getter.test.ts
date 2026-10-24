import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { imageMetadataGetter, laDinhDangAnhChoPhep } from "./image-metadata-getter.js";

// Module thuần (chỉ fs + image-size) - import tĩnh được, không cần setupTestEnv

const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "img-meta-"));
after(() => fs.rmSync(thuMuc, { recursive: true, force: true }));

function ghi(ten: string, buf: Buffer): string {
  const p = path.join(thuMuc, ten);
  fs.writeFileSync(p, buf);
  return p;
}

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/** Payload của GHSA-w3rx-r6r6-pgpr: entry ICNS dài 0 -> image-size 2.0.2 lặp vô hạn */
function icnsBom(): Buffer {
  const b = Buffer.alloc(24);
  b.write("icns", 0, "latin1");
  b.writeUInt32BE(24, 4);
  b.write("ic08", 8, "latin1");
  b.writeUInt32BE(0, 12);
  b.write("ic09", 16, "latin1");
  b.writeUInt32BE(0, 20);
  return b;
}

/** BMP hợp lệ: image-size ĐỌC ĐƯỢC, nên chỉ cổng magic byte mới khiến nó ra null */
function bmp(w: number, h: number): Buffer {
  const b = Buffer.alloc(54);
  b.write("BM", 0, "latin1");
  b.writeUInt32LE(54, 2);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  return b;
}

describe("laDinhDangAnhChoPhep", () => {
  it("nhận đúng 4 định dạng zca-js gọi getter: jpg, png, gif, webp", () => {
    assert.equal(laDinhDangAnhChoPhep(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
    assert.equal(laDinhDangAnhChoPhep(png(1, 1)), true);
    assert.equal(laDinhDangAnhChoPhep(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1")), true);
    assert.equal(laDinhDangAnhChoPhep(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1")), true);
  });

  it("từ chối ICNS, HEIF, BMP và buffer cụt", () => {
    assert.equal(laDinhDangAnhChoPhep(icnsBom()), false);
    assert.equal(laDinhDangAnhChoPhep(Buffer.from("\x00\x00\x00\x18ftypheic", "latin1")), false);
    assert.equal(laDinhDangAnhChoPhep(bmp(10, 10)), false);
    assert.equal(laDinhDangAnhChoPhep(Buffer.from([0xff, 0xd8])), false);
    assert.equal(laDinhDangAnhChoPhep(Buffer.alloc(0)), false);
  });
});

describe("imageMetadataGetter", () => {
  it("đọc đủ width/height/size của ảnh thật", async () => {
    const p = ghi("that.png", png(640, 480));
    assert.deepEqual(await imageMetadataGetter(p), { width: 640, height: 480, size: 33 });
  });

  it("byte ICNS đội đuôi .jpg trả null NGAY, không treo event loop", async () => {
    const p = ghi("bom.jpg", icnsBom());
    const batDau = Date.now();
    assert.equal(await imageMetadataGetter(p), null);
    assert.ok(Date.now() - batDau < 1000);
  });

  it("định dạng image-size đọc được nhưng ngoài danh sách vẫn ra null (cổng đứng trước parser)", async () => {
    assert.equal(await imageMetadataGetter(ghi("anh.jpg", bmp(10, 10))), null);
  });

  it("file không tồn tại trả null thay vì ném", async () => {
    assert.equal(await imageMetadataGetter(path.join(thuMuc, "khong-co.png")), null);
  });
});
