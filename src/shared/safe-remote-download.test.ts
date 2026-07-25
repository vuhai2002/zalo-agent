import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { downloadFromPublicUrl, readCappedStream } from "./safe-remote-download.js";

const streamOf = (...chunks: Buffer[]): Readable => Readable.from(chunks);

describe("readCappedStream", () => {
  it("đọc hết stream khi trong hạn mức", async () => {
    const data = await readCappedStream(streamOf(Buffer.from("abc"), Buffer.from("de")), 10);
    assert.equal(data.toString(), "abcde");
  });

  it("dừng ngay khi vượt hạn mức thay vì buffer hết rồi mới kiểm", async () => {
    const big = Buffer.alloc(4, 0x41);
    const stream = streamOf(big, big, big); // 12 byte, hạn 5
    await assert.rejects(() => readCappedStream(stream, 5), /vượt giới hạn/);
    assert.equal(stream.destroyed, true, "stream phải bị huỷ, không tải nốt phần còn lại");
  });

  it("đúng bằng hạn mức thì vẫn nhận", async () => {
    const data = await readCappedStream(streamOf(Buffer.alloc(8)), 8);
    assert.equal(data.byteLength, 8);
  });
});

describe("downloadFromPublicUrl - chặn trước khi mở kết nối", () => {
  const maxBytes = 1024;

  it("chặn URL trỏ vào loopback (dashboard của chính bot)", async () => {
    await assert.rejects(
      () => downloadFromPublicUrl("http://127.0.0.1:3900/api/threads", { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
  });

  it("chặn endpoint metadata của cloud", async () => {
    await assert.rejects(
      () => downloadFromPublicUrl("http://169.254.169.254/latest/meta-data/", { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
  });

  it("chặn IP nội bộ và IPv6 loopback ghi thẳng trong URL", async () => {
    await assert.rejects(
      () => downloadFromPublicUrl("http://192.168.1.1/router", { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
    await assert.rejects(
      () => downloadFromPublicUrl("http://[::1]:3900/", { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
  });

  it("chỉ nhận http/https", async () => {
    await assert.rejects(
      () => downloadFromPublicUrl("file:///C:/Windows/win.ini", { maxBytes }),
      /Chỉ hỗ trợ http\/https/,
    );
    await assert.rejects(
      () => downloadFromPublicUrl("ftp://vi-du.vn/tep.zip", { maxBytes }),
      /Chỉ hỗ trợ http\/https/,
    );
  });

  it("URL rác trả lỗi rõ ràng", async () => {
    await assert.rejects(
      () => downloadFromPublicUrl("khong-phai-url", { maxBytes }),
      /URL không hợp lệ/,
    );
  });
});
