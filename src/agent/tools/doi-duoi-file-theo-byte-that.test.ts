import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doiDuoiTheoByteThat } from "./doi-duoi-file-theo-byte-that.js";

// Module thuần - import tĩnh được, không cần setupTestEnv

/** Vài byte đầu của một file HEIF với brand cho sẵn (box `ftyp`) */
const heif = (brand: string) => Buffer.from(`\x00\x00\x00\x1cftyp${brand}\x00\x00\x00\x00`, "latin1");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = Buffer.from("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR", "latin1");

describe("doiDuoiTheoByteThat", () => {
  it("link .jpg mà CDN trả AVIF/HEIC thì đổi đuôi để zca-js gửi dạng file", () => {
    assert.equal(doiDuoiTheoByteThat("anh.jpg", heif("avif")), "anh.avif");
    assert.equal(doiDuoiTheoByteThat("anh.JPEG", heif("heic")), "anh.heic");
    assert.equal(doiDuoiTheoByteThat("anh.webp", heif("mif1")), "anh.heic");
  });

  it("BMP/TIFF đội đuôi ảnh cũng đổi; byte lạ không nhận ra thành .bin, KHÔNG thành .mp4", () => {
    assert.equal(doiDuoiTheoByteThat("a.png", Buffer.from("BM\x00\x00\x00\x00", "latin1")), "a.bmp");
    assert.equal(doiDuoiTheoByteThat("a.jpg", Buffer.from("II*\x00\x08\x00", "latin1")), "a.tif");
    assert.equal(doiDuoiTheoByteThat("a.jpg", heif("isom")), "a.bin", "mp4 đi nhánh upload video chờ websocket");
    assert.equal(doiDuoiTheoByteThat("a.jpg", Buffer.from("<html>", "latin1")), "a.bin");
  });

  it("ảnh thật đọc được giữ nguyên tên - kể cả khi đuôi lệch giữa các định dạng zca-js đều nhận", () => {
    assert.equal(doiDuoiTheoByteThat("anh.jpg", jpeg), "anh.jpg");
    assert.equal(doiDuoiTheoByteThat("anh.jpg", png), "anh.jpg");
  });

  it("file không mang đuôi ảnh thì không đụng tới", () => {
    assert.equal(doiDuoiTheoByteThat("bao-gia.pdf", heif("avif")), "bao-gia.pdf");
    assert.equal(doiDuoiTheoByteThat("tep-tai-ve", jpeg), "tep-tai-ve");
  });
});
