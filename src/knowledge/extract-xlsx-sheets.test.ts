import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { docChuTuFile } from "./doc-text-extract.js";
import { extractXlsxSheets } from "./extract-xlsx-sheets.js";
import { buildZipBuffer, xlsxNhieuSheetVaChuoi } from "./ooxml-zip-test-helper.js";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** Workbook tự dựng với rels Target tùy ý - để thử các dạng đường dẫn OPC hợp lệ */
function workbookTay(sheets: string, rels: string): Buffer {
  const sheet1 = `<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>noi dung</t></is></c><c r="B1"><v>7</v></c></row></sheetData></worksheet>`;
  return buildZipBuffer([
    { name: "xl/workbook.xml", data: Buffer.from(`<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>${sheets}</sheets></workbook>`) },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1) },
  ]);
}
const REL = (id: string, target: string) =>
  `<Relationship Id="${id}" Type="${RNS}/worksheet" Target="${target}"/>`;

/** Workbook 3 sheet: thường (có dòng TỔNG là công thức), ẩn, ẩn hẳn */
async function workbookBaSheet(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Tháng 3");
  a.addRow(["NGÀY", "SỐ CÂY"]);
  a.addRow(["3/4", 95]);
  a.addRow(["3/7", 114]);
  a.addRow(["3/10", 37]);
  a.addRow(["ghi chú", "9.356"]); // chuỗi trông như số - KHÔNG được cộng
  a.getCell("B6").value = { formula: "SUM(B2:B4)", result: 246 };
  const b = wb.addWorksheet("Phụ");
  b.state = "hidden";
  b.addRow(["dữ liệu phụ"]);
  const c = wb.addWorksheet("Bí mật");
  c.state = "veryHidden";
  c.addRow(["CHU AN HAN"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("extractXlsxSheets - theo sheet, có trạng thái ẩn và kiểu ô", () => {
  it("trả đúng tên + trạng thái ẩn theo workbook.xml", async () => {
    const ds = await extractXlsxSheets(await workbookBaSheet());
    assert.deepEqual(
      ds.map((s) => [s.ten, s.hienThi]),
      [
        ["Tháng 3", "hien"],
        ["Phụ", "an"],
        ["Bí mật", "an-han"],
      ],
    );
    assert.deepEqual(ds[2]!.hang, [], "sheet ẩn hẳn không được đọc nội dung");
  });

  it("đánh dấu ô số, ô công thức, ô chuỗi", async () => {
    const [thang3] = await extractXlsxSheets(await workbookBaSheet());
    const o = (r: number, c: number) => thang3!.hang[r]![c]!;
    assert.deepEqual(o(1, 1), { giaTri: "95", laSo: true, laCongThuc: false });
    assert.deepEqual(o(4, 1), { giaTri: "9.356", laSo: false, laCongThuc: false });
    assert.deepEqual(o(5, 1), { giaTri: "246", laSo: true, laCongThuc: true });
    assert.equal(o(0, 1).giaTri, "SỐ CÂY");
  });

  it("thiếu workbook.xml (tệp tự dựng) vẫn đọc theo thứ tự file, tên Sheet N", async () => {
    const buf = xlsxNhieuSheetVaChuoi(['<row r="1"><c r="A1" t="s"><v>0</v></c></row>'], ["mot"]);
    const ds = await extractXlsxSheets(buf);
    assert.equal(ds.length, 1);
    assert.equal(ds[0]!.ten, "Sheet 1");
    assert.equal(ds[0]!.hang[0]![0]!.giaTri, "mot");
  });

  it("Target dạng ../xl/worksheets/sheet1.xml (OPC hợp lệ) vẫn tìm ra sheet", async () => {
    const ds = await extractXlsxSheets(workbookTay('<sheet name="A" sheetId="1" r:id="rId1"/>', REL("rId1", "../xl/worksheets/sheet1.xml")));
    assert.deepEqual(ds.map((s) => s.ten), ["A"]);
    assert.equal(ds[0]!.hang[0]![0]!.giaTri, "noi dung");
  });

  it("hai <sheet> khai trùng một rId chỉ đọc một lần (không cộng hai lần)", async () => {
    const ds = await extractXlsxSheets(
      workbookTay('<sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId1"/>', REL("rId1", "worksheets/sheet1.xml")),
    );
    assert.equal(ds.length, 1);
  });

  it("Kho tri thức (extractXlsxText) bỏ sheet ẩn hẳn, vẫn đọc sheet ẩn thường", async () => {
    const chu = await docChuTuFile(await workbookBaSheet(), "xlsx");
    assert.doesNotMatch(chu, /CHU AN HAN/);
    assert.match(chu, /dữ liệu phụ/);
    assert.match(chu, /3\/4 \| 95/);
  });
});
