import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/regex) - không chạm env/DB nên import tĩnh được
import { docChuTuFile } from "./doc-text-extract.js";
import { renderXlsx } from "../documents/render-xlsx.js";
import { xlsxRong, xlsxTuSheetVaChuoi, zipNhieuEntryVuaDu } from "./ooxml-zip-test-helper.js";

const excelORong = () =>
  fs.readFileSync(new URL("./fixtures/excel-o-rong-co-dinh-dang.xlsx", import.meta.url));

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

describe("extract-xlsx-text - fixture Excel THẬT (src/knowledge/fixtures)", () => {
  it("ô rỗng tự đóng của Excel KHÔNG nuốt ô kế tiếp", async () => {
    // Ca ĐÃ ĐO hỏng ở bản regex cũ: ra "Mon | 1" thay vì "Mon |  | Gia" - số 1
    // là INDEX sharedString bị lộ ra ngoài, không phải chữ thật. Fixture ghi
    // nội dung không dấu ("Mon"/"Gia") - giữ nguyên đúng byte Excel đã ghi,
    // không phải lỗi thiếu dấu tiếng Việt của test.
    const chu = await docChuTuFile(excelORong(), "xlsx");
    const dongDau = chu.split("\n")[0]!;
    assert.match(dongDau, /Mon \|\s*\| Gia/, `hàng đầu đọc ra: ${JSON.stringify(dongDau)}`);
    const dongHai = chu.split("\n")[1]!;
    assert.match(dongHai, /Ca phe \|\s*\| 25000/, `hàng hai đọc ra: ${JSON.stringify(dongHai)}`);
  });

  it("ô rỗng tự đóng Ở CUỐI HÀNG vẫn giữ đúng số cột (không có ô sau để lấp hộ)", async () => {
    // Khác ca trên: fixture Excel thật có ô rỗng NẰM GIỮA hàng, nên cơ chế
    // "lấp cột theo ô kế tiếp" (themOVaoDong khi gặp ô có r= sau đó) tình cờ
    // che luôn cả lỗi thiếu xử lý ô tự đóng. Test này đặt ô rỗng Ở CUỐI - không
    // ô nào phía sau để lấp hộ - mới cô lập ĐÚNG nhánh "ô tự đóng" một mình.
    const buf = xlsxTuSheetVaChuoi(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"/></row>',
      ["X", "Y", "Z"],
    );
    const chu = await docChuTuFile(buf, "xlsx");
    const dong = chu.split("\n");
    assert.equal(dong[0], "X | Y");
    assert.equal(dong[1], "Z | ", `hàng 2 phải giữ đủ 2 cột (ô B rỗng ở cuối): ${JSON.stringify(dong[1])}`);
  });
});

describe("extract-xlsx-text - bom và trần an toàn", () => {
  it("tổng giải nén vượt trần bị từ chối dù mỗi entry đều dưới trần", async () => {
    // Trần theo TỪNG entry là chưa đủ: xlsx đọc sharedStrings.xml CỘNG mọi
    // sheet - 4 entry x 20 MB (mỗi entry dưới trần 32 MB) nhưng tổng 80 MB
    // vượt trần archive 64 MB (xem ooxml-zip-test-helper.ts cho lý do chọn
    // 20 MB đóng thẻ đầy đủ thay vì để hở).
    await assert.rejects(
      () => docChuTuFile(zipNhieuEntryVuaDu(), "xlsx"),
      /vượt quá giới hạn/i,
    );
  });

  it("xlsx toàn ô rỗng NÉM lỗi", async () => {
    await assert.rejects(() => docChuTuFile(xlsxRong(), "xlsx"), /không đọc được chữ nào/i);
  });
});
