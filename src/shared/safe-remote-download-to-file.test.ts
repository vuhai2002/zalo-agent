import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import {
  downloadToFileFromPublicUrl,
  ghiStreamRaFileCoTran,
} from "./safe-remote-download-to-file.js";

const streamOf = (...chunks: Buffer[]): Readable => Readable.from(chunks);

describe("ghiStreamRaFileCoTran", () => {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "ghi-stream-"));
  after(() => fs.rmSync(thuMuc, { recursive: true, force: true }));
  let dem = 0;
  const duongDanMoi = () => path.join(thuMuc, `f${dem++}.bin`);

  it("ghi hết stream ra file khi trong trần, trả đúng số byte", async () => {
    const p = duongDanMoi();
    const bytes = await ghiStreamRaFileCoTran(streamOf(Buffer.from("abc"), Buffer.from("de")), p, 100);

    assert.equal(bytes, 5);
    assert.equal(fs.readFileSync(p, "utf-8"), "abcde");
  });

  it("đúng bằng trần thì vẫn nhận", async () => {
    const p = duongDanMoi();
    assert.equal(await ghiStreamRaFileCoTran(streamOf(Buffer.alloc(8)), p, 8), 8);
  });

  it("vượt trần thì NÉM và HỦY nguồn - không tải nốt phần còn lại", async () => {
    const p = duongDanMoi();
    const khuc = Buffer.alloc(4, 0x41);
    const nguon = streamOf(khuc, khuc, khuc); // 12 byte, trần 5

    await assert.rejects(() => ghiStreamRaFileCoTran(nguon, p, 5), /vượt giới hạn/);
    // Đo BẤT BIẾN (nguồn phải ngừng chảy), không ghim một dòng code cụ thể:
    // `pipeline` mới là thứ hủy stream, còn `nguon.destroy()` trong `catch` chỉ
    // là thắt lưng thừa - phá dòng đó thì ca này VẪN XANH. Ca này đỏ khi ai đó
    // thay `pipeline` bằng vòng lặp tự viết và quên dọn.
    assert.equal(nguon.destroyed, true, "nguồn còn chảy là CDN đẩy hết video 2GB qua mạng của VPS");
  });

  it("HẠN CHÓT TỔNG cắt được kiểu nhỏ giọt - thứ timeout nhàn rỗi không bắt nổi", async () => {
    const p = duongDanMoi();
    // Nguồn nhỏ giọt: mỗi 20ms một byte, không bao giờ im lặng đủ lâu để chạm
    // timeout nhàn rỗi, và không bao giờ đủ byte để chạm trần dung lượng.
    // Không có hạn chót tổng thì vòng này chạy mãi và giữ luôn một suất tải.
    const nguon = new Readable({
      read() {
        setTimeout(() => this.push(Buffer.alloc(1)), 20);
      },
    });

    await assert.rejects(
      () => ghiStreamRaFileCoTran(nguon, p, 10 * 1024 * 1024, 300),
      /đã dừng/,
      "thiếu hạn chót tổng là hai link nhỏ giọt khoá cả tính năng tải video",
    );
    nguon.destroy();
  });

  it("hạn chót KHÔNG cắt oan lượt tải bình thường", async () => {
    const p = duongDanMoi();
    const bytes = await ghiStreamRaFileCoTran(streamOf(Buffer.alloc(64)), p, 1024, 60_000);
    assert.equal(bytes, 64);
  });

  it("stream RỖNG là HỎNG chứ không phải thành công cỡ 0", async () => {
    const p = duongDanMoi();
    // File 0 byte gửi lên Zalo thành một video không mở được - người nhận không
    // biết là hỏng, tệ hơn hẳn một câu báo lỗi.
    await assert.rejects(() => ghiStreamRaFileCoTran(streamOf(), p, 100), /rỗng/);
  });

  it("nguồn ném giữa chừng thì lỗi đó nổi lên, không nuốt", async () => {
    const p = duongDanMoi();
    const nguon = new Readable({
      read() {
        this.destroy(new Error("kết nối đứt"));
      },
    });
    await assert.rejects(() => ghiStreamRaFileCoTran(nguon, p, 100), /kết nối đứt/);
  });
});

describe("downloadToFileFromPublicUrl - thừa hưởng đủ lớp chặn của downloadFromPublicUrl", () => {
  // Đường dẫn video do TikWM/yt-dlp trả về, tức chuỗi từ bên thứ ba đi thẳng
  // vào một request của máy chủ. Nhánh này PHẢI qua cùng lớp bảo vệ như tool
  // đọc web, không phải một đường tải riêng lỏng hơn.
  // Đường dẫn RIÊNG mỗi lần chạy. Bản trước dùng một tên cố định trong
  // `os.tmpdir()`, nên chỉ cần file đó từng được tạo (bởi bản có bug, hay bởi
  // tiến trình khác) là ca cuối ĐỎ VĨNH VIỄN kể cả khi code đã đúng.
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "khong-tao-")), "khong-duoc-tao.bin");
  after(() => fs.rmSync(path.dirname(p), { recursive: true, force: true }));
  const maxBytes = 1024;

  it("chặn loopback", async () => {
    await assert.rejects(
      () => downloadToFileFromPublicUrl("http://127.0.0.1:3900/x.mp4", p, { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
  });

  it("chặn endpoint metadata đám mây", async () => {
    await assert.rejects(
      () => downloadToFileFromPublicUrl("http://169.254.169.254/latest/meta-data/", p, { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
  });

  it("chặn IP nội bộ và IPv6 loopback", async () => {
    await assert.rejects(
      () => downloadToFileFromPublicUrl("http://192.168.1.1/x.mp4", p, { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
    await assert.rejects(
      () => downloadToFileFromPublicUrl("http://[::1]:3900/x.mp4", p, { maxBytes }),
      /Chặn địa chỉ nội bộ/,
    );
  });

  it("chỉ nhận http/https", async () => {
    await assert.rejects(
      () => downloadToFileFromPublicUrl("file:///C:/Windows/win.ini", p, { maxBytes }),
      /Chỉ hỗ trợ http\/https/,
    );
  });

  it("URL rác trả lỗi rõ ràng", async () => {
    await assert.rejects(
      () => downloadToFileFromPublicUrl("khong-phai-url", p, { maxBytes }),
      /URL không hợp lệ/,
    );
  });

  it("KHÔNG tạo file nào khi bị chặn từ trước", async () => {
    assert.equal(fs.existsSync(p), false, "tạo file rồi mới chặn là rác đọng lại sau mỗi link xấu");
  });
});
