import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/regex) - không chạm env/DB nên import tĩnh được
import { docChuTuFile } from "./doc-text-extract.js";
import { renderXlsx } from "../documents/render-xlsx.js";

describe("extract-xlsx-text (qua docChuTuFile)", () => {
  it("mỗi hàng thành một dòng chữ, các ô nối bằng ' | '", async () => {
    const buf = await renderXlsx([
      {
        name: "Bảng giá",
        headers: ["Món", "Giá"],
        rows: [[{ kind: "text", value: "Cà phê" }, { kind: "number", value: 25000, format: "plain" }]],
      },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /Cà phê \| 25000/);
  });

  it("hàng header cũng đọc ra, không chỉ hàng dữ liệu", async () => {
    const buf = await renderXlsx([
      { name: "Bảng giá", headers: ["Món", "Giá"], rows: [[{ kind: "text", value: "Trà" }, { kind: "number", value: 15000, format: "plain" }]] },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /Món \| Giá/);
  });

  it("nhiều sheet đều đọc được, không chỉ sheet đầu", async () => {
    const buf = await renderXlsx([
      { name: "Sheet A", headers: ["X"], rows: [[{ kind: "text", value: "một" }]] },
      { name: "Sheet B", headers: ["Y"], rows: [[{ kind: "text", value: "hai" }]] },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /một/);
    assert.match(chu, /hai/);
  });

  it("ô công thức đọc ra GIÁ TRỊ đã tính, không phải chuỗi công thức", async () => {
    const buf = await renderXlsx([
      {
        name: "Báo giá",
        headers: ["SL", "Đơn giá", "Thành tiền"],
        rows: [
          [
            { kind: "number", value: 2, format: "plain" },
            { kind: "number", value: 1500, format: "plain" },
            { kind: "formula", op: "multiply", columns: ["A", "B"] },
          ],
        ],
      },
    ]);
    const chu = await docChuTuFile(buf, "xlsx");
    assert.match(chu, /3000/, "phải ra giá trị đã tính (2 x 1500), không phải '=A2*B2'");
  });

  it("file xlsx hỏng (không phải zip) ném lỗi tiếng Việt đọc được", async () => {
    await assert.rejects(
      () => docChuTuFile(Buffer.from("khong phai file zip"), "xlsx"),
      /không phải file zip/i,
    );
  });
});
