import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/regex) - không chạm env/DB nên import tĩnh được
import { docChuTuFile } from "./doc-text-extract.js";
import { renderDocx } from "../documents/render-docx.js";

describe("extract-docx-text (qua docChuTuFile)", () => {
  it("đọc lại được chữ từ chính file docx do bot sinh ra", async () => {
    const buf = await renderDocx(
      [{ type: "paragraph", text: "Đổi trả trong 7 ngày" }],
      { title: "Chính sách" },
    );
    const chu = await docChuTuFile(buf, "docx");
    assert.match(chu, /Đổi trả trong 7 ngày/);
  });

  it("tiêu đề văn bản (title) và heading đều đọc ra được", async () => {
    const buf = await renderDocx([
      { type: "heading", text: "Bảo hành", level: 1 },
      { type: "paragraph", text: "12 tháng kể từ ngày mua" },
    ]);
    const chu = await docChuTuFile(buf, "docx");
    assert.match(chu, /Bảo hành/);
    assert.match(chu, /12 tháng kể từ ngày mua/);
  });

  it("heading dịch sang markdown '#' để chunk-text nhận diện được tiêu đề", async () => {
    const buf = await renderDocx([
      { type: "heading", text: "Chính sách đổi trả", level: 2 },
      { type: "paragraph", text: "Trong vòng 7 ngày." },
    ]);
    const chu = await docChuTuFile(buf, "docx");
    assert.match(chu, /^##?\s+Chính sách đổi trả$/m);
  });

  it("nhiều đoạn văn giữ đúng thứ tự và nội dung", async () => {
    const buf = await renderDocx([
      { type: "paragraph", text: "Đoạn một" },
      { type: "paragraph", text: "Đoạn hai" },
    ]);
    const chu = await docChuTuFile(buf, "docx");
    assert.ok(chu.indexOf("Đoạn một") < chu.indexOf("Đoạn hai"));
  });

  it("file docx hỏng (không phải zip) ném lỗi tiếng Việt đọc được", async () => {
    await assert.rejects(
      () => docChuTuFile(Buffer.from("khong phai file zip"), "docx"),
      /không phải file zip/i,
    );
  });
});
