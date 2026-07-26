import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateImageTokens,
  pickImageVariant,
  readImageSize,
} from "./zalo-image-variant.js";

// Module thuần - import tĩnh được, không cần setupTestEnv

// Payload thật của tin nhắn ảnh Zalo có đủ 5 biến thể
const FULL_CONTENT = {
  title: "dò vé số này cho tôi nhé",
  thumb: "https://cdn.zalo.vn/thumb.jpg",
  normalUrl: "https://cdn.zalo.vn/normal.jpg",
  href: "https://cdn.zalo.vn/href.jpg",
  oriUrl: "https://cdn.zalo.vn/ori.jpg",
  hd: "https://cdn.zalo.vn/hd.jpg",
};

describe("pickImageVariant", () => {
  it("normal (mặc định) KHÔNG lấy bản hd - đó là chỗ tốn token nhất", () => {
    const picked = pickImageVariant(FULL_CONTENT, "normal");
    assert.equal(picked?.variant, "normalUrl");
    assert.equal(picked?.url, "https://cdn.zalo.vn/normal.jpg");
  });

  it("hd giữ được hành vi cũ khi cần đọc chi tiết rất nhỏ", () => {
    assert.equal(pickImageVariant(FULL_CONTENT, "hd")?.variant, "hd");
  });

  it("thumb lấy bản nhỏ nhất", () => {
    assert.equal(pickImageVariant(FULL_CONTENT, "thumb")?.variant, "thumb");
  });

  it("thiếu biến thể mong muốn thì lùi sang cỡ khác chứ không bỏ ảnh", () => {
    const onlyHd = { hd: "https://cdn.zalo.vn/hd.jpg" };
    assert.equal(pickImageVariant(onlyHd, "normal")?.variant, "hd");

    const onlyThumb = { thumb: "https://cdn.zalo.vn/t.jpg" };
    assert.equal(pickImageVariant(onlyThumb, "hd")?.variant, "thumb");
  });

  it("bỏ qua giá trị không phải URL http (Zalo có lúc trả chuỗi rỗng)", () => {
    const messy = { normalUrl: "", href: "   ", hd: "https://cdn.zalo.vn/hd.jpg" };
    assert.equal(pickImageVariant(messy, "normal")?.variant, "hd");
    assert.equal(pickImageVariant({ normalUrl: "data:image/png;base64,x" }, "normal"), null);
  });

  it("content không có ảnh trả null", () => {
    assert.equal(pickImageVariant({ title: "chỉ có chữ" }, "normal"), null);
  });
});

describe("estimateImageTokens", () => {
  it("ảnh vé số HD thật (977x2128) tốn khoảng 2772 token mỗi lần vào context", () => {
    assert.equal(estimateImageTokens(977, 2128), 2772);
  });

  it("cùng ảnh đó ở cỡ normal (một nửa cạnh) rẻ hơn khoảng 4 lần", () => {
    const hd = estimateImageTokens(977, 2128);
    const normal = estimateImageTokens(489, 1064);
    assert.ok(normal < hd / 3.5, `normal=${normal} phải rẻ hơn hẳn hd=${hd}`);
  });

  it("kích thước không hợp lệ trả 0, không NaN", () => {
    assert.equal(estimateImageTokens(0, 100), 0);
    assert.equal(estimateImageTokens(-5, 10), 0);
  });
});

describe("readImageSize", () => {
  it("đọc được kích thước PNG", () => {
    // Signature + IHDR: width=1920, height=1080
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);
    assert.deepEqual(readImageSize(png), { width: 1920, height: 1080 });
  });

  it("đọc được kích thước JPEG qua marker SOF0", () => {
    // FFD8 (SOI) + FFE0 segment rác + FFC0 (SOF0) mang height/width
    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x08, 0x50, 0x03, 0xd1, 0x03, 0x00, 0x00, 0x00, 0x00,
    ]);
    assert.deepEqual(readImageSize(jpeg), { width: 977, height: 2128 });
  });

  it("dữ liệu rác trả null thay vì throw hay lặp vô hạn", () => {
    assert.equal(readImageSize(Buffer.from([1, 2, 3])), null);
    assert.equal(readImageSize(Buffer.alloc(0)), null);
    // JPEG có segment length = 0 (hỏng) không được làm treo vòng lặp
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0, 0, 0, 0, 0, 0]);
    assert.equal(readImageSize(broken), null);
  });
});
