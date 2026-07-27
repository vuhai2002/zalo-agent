import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ dùng exceljs) - không chạm env/DB nên import tĩnh được
import { renderXlsx, safeSheetName } from "./render-xlsx.js";
import { XLSX_THEMES } from "./xlsx-themes.js";
import { readZipEntryText, listZipEntries } from "../shared/read-zip-entry.js";
import type { Sheet } from "./document-content-schema.js";

const sheetXml = async (sheets: Sheet[], index = 1) =>
  readZipEntryText(await renderXlsx(sheets), `xl/worksheets/sheet${index}.xml`);

/** Bảng báo giá: 2 dòng hàng (thành tiền = SL x đơn giá) + 1 dòng tổng */
const BAO_GIA: Sheet = {
  name: "Báo giá",
  headers: ["Sản phẩm", "Số lượng", "Đơn giá (VND)", "Thành tiền (VND)"],
  rows: [
    [
      { kind: "text", value: "Bàn phím cơ" },
      { kind: "number", value: 2, format: "plain" },
      { kind: "number", value: 1_500_000, format: "money" },
      { kind: "formula", op: "multiply", columns: ["B", "C"] },
    ],
    [
      { kind: "text", value: "Chuột không dây" },
      { kind: "number", value: 3, format: "plain" },
      { kind: "number", value: 450_000, format: "money" },
      { kind: "formula", op: "multiply", columns: ["B", "C"] },
    ],
    [
      { kind: "text", value: "Tổng cộng" },
      { kind: "text", value: "" },
      { kind: "text", value: "" },
      { kind: "formula", op: "sum", column: "D", fromRow: 2, toRow: 3 },
    ],
  ],
};

/** Tách các ô có công thức ra để soi <f> và <v> */
function formulaCells(xml: string): string[] {
  return xml.match(/<c[^>]*>(?:(?!<\/c>).)*<f>.*?<\/c>/g) ?? [];
}

describe("renderXlsx", () => {
  it("tạo file .xlsx hợp lệ", async () => {
    const buf = await renderXlsx([BAO_GIA]);
    assert.equal(buf.subarray(0, 2).toString(), "PK");
    const entries = listZipEntries(buf);
    assert.ok(entries.includes("xl/worksheets/sheet1.xml"));
    assert.ok(entries.includes("xl/styles.xml"));
  });

  it("MỌI ô công thức đều có giá trị cache <v> - lý do tồn tại của exceljs", async () => {
    const xml = await sheetXml([BAO_GIA]);
    const cells = formulaCells(xml);
    assert.equal(cells.length, 3, "phải có đúng 3 ô công thức");
    const missing = cells.filter((c) => !/<v>/.test(c));
    assert.deepEqual(
      missing,
      [],
      "ô công thức thiếu <v> sẽ hiện TRỐNG trong mọi công cụ xem trước",
    );
  });

  it("giá trị cache tính ĐÚNG (nhân ra tích, SUM ra tổng)", async () => {
    const xml = await sheetXml([BAO_GIA]);
    // 2 x 1.500.000 = 3.000.000 · 3 x 450.000 = 1.350.000 · tổng = 4.350.000
    for (const expected of ["3000000", "1350000", "4350000"]) {
      assert.ok(xml.includes(`<v>${expected}</v>`), `thiếu giá trị ${expected}`);
    }
  });

  it("công thức KHÔNG kèm dấu = trong <f> (chuẩn ECMA-376)", async () => {
    const xml = await sheetXml([BAO_GIA]);
    assert.ok(!/<f>=/.test(xml), "dấu = trong <f> là sai chuẩn OOXML");
    assert.ok(xml.includes("<f>B2*C2</f>"), "công thức nhân phải trỏ đúng dòng");
    assert.ok(xml.includes("<f>SUM(D2:D3)</f>"), "công thức tổng phải trỏ đúng dải");
  });

  it("giữ nguyên tiếng Việt có dấu", async () => {
    const buf = await renderXlsx([BAO_GIA]);
    const shared = readZipEntryText(buf, "xl/sharedStrings.xml");
    assert.ok(shared.includes("Bàn phím cơ"));
    assert.ok(shared.includes("Đơn giá (VND)"));
  });

  it("header đậm + đóng băng dòng 1, font Arial, số tiền có phân cách nghìn", async () => {
    const buf = await renderXlsx([BAO_GIA]);
    const xml = readZipEntryText(buf, "xl/worksheets/sheet1.xml");
    const styles = readZipEntryText(buf, "xl/styles.xml");
    assert.ok(xml.includes("pane"), "phải đóng băng dòng header");
    assert.ok(styles.includes("Arial"), "font phải là Arial");
    assert.ok(styles.includes('<b/>'), "header phải in đậm");
    // "#,##0" là định dạng CÓ SẴN của Excel (numFmtId 3) nên không khai dạng
    // chuỗi trong <numFmts> - tìm theo ID mới đúng
    assert.ok(
      /numFmtId="3"[^>]*applyNumberFormat="1"/.test(styles),
      "số tiền phải áp định dạng phân cách nghìn (numFmtId 3)",
    );
  });

  it("phần trăm dùng định dạng riêng (custom), không lẫn với tiền", async () => {
    const buf = await renderXlsx([
      {
        name: "Tỉ lệ",
        headers: ["Mục", "Tỉ lệ"],
        rows: [[{ kind: "text", value: "Chiết khấu" }, { kind: "number", value: 0.15, format: "percent" }]],
      },
    ]);
    // "0.0%" KHÔNG phải định dạng có sẵn nên phải khai trong <numFmts>
    assert.ok(readZipEntryText(buf, "xl/styles.xml").includes("0.0%"));
  });

  it("nhiều sheet đều được tạo", async () => {
    const buf = await renderXlsx([
      BAO_GIA,
      { name: "Ghi chú", headers: ["Nội dung"], rows: [[{ kind: "text", value: "abc" }]] },
    ]);
    const entries = listZipEntries(buf);
    assert.ok(entries.includes("xl/worksheets/sheet1.xml"));
    assert.ok(entries.includes("xl/worksheets/sheet2.xml"));
  });

  it("tên sheet có ký tự Excel cấm bị làm sạch, file vẫn hợp lệ", async () => {
    assert.equal(safeSheetName("Báo giá: Q3/2026 [bản 1]", "Sheet1"), "Báo giá  Q3 2026  bản 1");
    assert.equal(safeSheetName("///", "Sheet1"), "Sheet1", "rỗng sau khi lọc thì dùng tên dự phòng");
    assert.equal(safeSheetName("x".repeat(50), "Sheet1").length, 31, "Excel giới hạn 31 ký tự");

    const buf = await renderXlsx([{ ...BAO_GIA, name: "Báo giá: Q3/2026" }]);
    assert.equal(buf.subarray(0, 2).toString(), "PK");
  });

  it("marker **đậm** trong ô chữ thành rich text bold, dấu sao không lọt vào file", async () => {
    const buf = await renderXlsx([
      {
        name: "Đậm",
        headers: ["**Mục**", "Giá trị"],
        rows: [
          [
            { kind: "text", value: "**Tổng cộng** (đã gồm VAT)" },
            { kind: "number", value: 100, format: "plain" },
          ],
        ],
      },
    ]);
    const shared = readZipEntryText(buf, "xl/sharedStrings.xml");
    assert.ok(!shared.includes("**"), "dấu ** không được xuất hiện trong file");
    assert.ok(shared.includes("Tổng cộng"), "chữ trong marker phải còn nguyên");
    assert.ok(shared.includes("Mục"), "header phải được lọc marker");
    // Rich text: đoạn "Tổng cộng" nằm trong run có <b/>
    assert.match(shared, /<b\/>.*?Tổng cộng/s, "phần trong ** phải in đậm");
  });

  it("banner title + subtitle: merge hết bề ngang, navy, chữ trắng 16pt", async () => {
    const buf = await renderXlsx([
      {
        ...BAO_GIA,
        title: "BÁO CÁO TỔNG HỢP KIM CƯƠNG",
        subtitle: "Cập nhật đến 26/07/2026",
      },
    ]);
    const sheet = readZipEntryText(buf, "xl/worksheets/sheet1.xml");
    const styles = readZipEntryText(buf, "xl/styles.xml");
    assert.match(sheet, /<mergeCell ref="A1:D1"\/>/, "title phải merge hết 4 cột");
    assert.match(sheet, /<mergeCell ref="A2:D2"\/>/, "subtitle phải merge hết 4 cột");
    assert.ok(styles.includes("FF1F3864"), "phải có màu navy");
    assert.match(styles, /sz val="16"/, "title phải 16pt");
    const shared = readZipEntryText(buf, "xl/sharedStrings.xml");
    assert.ok(shared.includes("BÁO CÁO TỔNG HỢP KIM CƯƠNG"));
  });

  it("CÓ banner thì công thức TỰ DỊCH DÒNG - model đánh số coi header là dòng 1", async () => {
    const buf = await renderXlsx([
      { ...BAO_GIA, title: "BÁO GIÁ", subtitle: "Tháng 7" },
    ]);
    const sheet = readZipEntryText(buf, "xl/worksheets/sheet1.xml");
    // Banner(1) + subtitle(2) + dòng thở(3) + header(4) -> dữ liệu từ dòng 5
    assert.ok(sheet.includes("<f>B5*C5</f>"), "công thức nhân phải trỏ dòng thật (5)");
    assert.ok(sheet.includes("<f>SUM(D5:D6)</f>"), "SUM(D2:D3) của model phải dịch thành SUM(D5:D6)");
    // Giá trị cache vẫn đúng bất kể dịch dòng
    for (const expected of ["3000000", "1350000", "4350000"]) {
      assert.ok(sheet.includes(`<v>${expected}</v>`), `thiếu giá trị ${expected}`);
    }
    // Freeze ngay dưới header (dòng 4)
    assert.match(sheet, /ySplit="4"/);
  });

  it("note cuối bảng: đỏ, nghiêng; ô chữ wrap; số nhập tay tô màu theo theme", async () => {
    const buf = await renderXlsx([
      { ...BAO_GIA, theme: "burgundy", note: "Lưu ý: số liệu là cáo buộc ban đầu, chưa phải bản án." },
    ]);
    const styles = readZipEntryText(buf, "xl/styles.xml");
    const shared = readZipEntryText(buf, "xl/sharedStrings.xml");
    assert.ok(shared.includes("chưa phải bản án"), "note phải vào file");
    assert.ok(styles.includes("FFC00000"), "note phải màu đỏ cảnh báo (không đổi theo theme)");
    assert.match(styles, /<i\/>/, "note phải in nghiêng");
    // Số nhập tay tô màu theme để hài hòa cả trang; ô công thức để đen -
    // người đọc phân biệt được dữ liệu gốc với kết quả tính (quy ước skill xlsx)
    assert.ok(styles.includes("FF8B2635"), "số nhập tay phải mang màu của theme đang dùng");
    assert.match(styles, /wrapText="1"/, "ô chữ phải wrap");
  });

  it("theme đổi được: mỗi tông ra file màu KHÁC nhau (10 báo cáo không ra 10 file giống hệt)", async () => {
    const colorsOf = async (theme?: Sheet["theme"]) => {
      const buf = await renderXlsx([{ ...BAO_GIA, title: "BÁO CÁO", theme }]);
      return readZipEntryText(buf, "xl/styles.xml");
    };
    const navy = await colorsOf("navy");
    const green = await colorsOf("green");
    const burgundy = await colorsOf("burgundy");

    assert.ok(navy.includes("FF1F3864"), "navy phải dùng màu navy");
    assert.ok(green.includes("FF1E6B3A"), "green phải dùng màu xanh lá");
    assert.ok(burgundy.includes("FF8B2635"), "burgundy phải dùng màu đỏ rượu");
    assert.notEqual(navy, green, "hai theme phải cho ra style khác nhau");
    // Không chọn theme -> navy mặc định
    assert.ok((await colorsOf(undefined)).includes("FF1F3864"));
  });

  it("mọi theme đều đạt WCAG AA (>=4.5:1) cho chữ trắng trên nền header", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [0, 2, 4]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const [name, theme] of Object.entries(XLSX_THEMES)) {
      // Bỏ 2 ký tự alpha đầu của ARGB
      const bg = luminance(theme.header.slice(2));
      const ratio = (1 + 0.05) / (bg + 0.05);
      assert.ok(ratio >= 4.5, `theme "${name}" chỉ đạt ${ratio.toFixed(2)}:1, chữ trắng khó đọc`);
    }
  });

  it("sọc xen kẽ: dòng chẵn có nền nhạt để mắt không lạc dòng", async () => {
    const buf = await renderXlsx([BAO_GIA]);
    const styles = readZipEntryText(buf, "xl/styles.xml");
    assert.ok(styles.includes("FFF2F5FA"), "phải có nền sọc nhạt của theme navy");
  });

  it("ô công thức không tính được vẫn ghi số 0, không để trống", async () => {
    // Nhân với ô chữ -> không tính ra số
    const xml = await sheetXml([
      {
        name: "Lỗi",
        headers: ["A", "B", "C"],
        rows: [
          [
            { kind: "text", value: "chữ" },
            { kind: "text", value: "chữ" },
            { kind: "formula", op: "multiply", columns: ["A", "B"] },
          ],
        ],
      },
    ]);
    const cells = formulaCells(xml);
    assert.equal(cells.length, 1);
    assert.ok(/<v>0<\/v>/.test(cells[0]!), "không tính được thì ghi 0 thay vì để trống");
  });
});
