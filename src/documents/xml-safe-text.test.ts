import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SaxesParser } from "saxes";
// Module thuần (thư viện docx/exceljs + zip) - không chạm env/DB nên import tĩnh được
import { listZipEntries, readZipEntryText } from "../shared/read-zip-entry.js";
import { renderDocx } from "./render-docx.js";
import { renderXlsx } from "./render-xlsx.js";
import { boKyTuXmlCam, lamSachChuTaiLieu } from "./xml-safe-text.js";
import type { Sheet } from "./document-content-schema.js";

const cc = (...ma: number[]) => String.fromCharCode(...ma);
/** Đủ họ ký tự XML cấm: C0 lẻ, NUL, U+FFFE/U+FFFF, hai kiểu surrogate lẻ */
const BAN = `A${cc(0, 1, 8, 0xb, 0xc, 0xe, 0x1f)}B${cc(0xfffe, 0xffff)}C${cc(0xd800)}D${cc(0xdfff)}E`;

/** Bộ phân tích XML chuẩn (saxes báo lỗi đúng ký tự cấm) - đo cái Word sẽ gặp */
function phanTichXml(xml: string): void {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", (err) => {
    throw err;
  });
  parser.write(xml).close();
}

async function kiemMoiFileXml(zip: Buffer): Promise<void> {
  for (const ten of listZipEntries(zip).filter((e) => e.endsWith(".xml") || e.endsWith(".rels"))) {
    const xml = await readZipEntryText(zip, ten);
    assert.doesNotThrow(() => phanTichXml(xml), `${ten} không phải XML hợp lệ`);
  }
}

describe("boKyTuXmlCam", () => {
  it("bỏ đúng ký tự cấm, giữ tab/xuống dòng/CR, emoji (cặp surrogate) và tiếng Việt", () => {
    assert.equal(boKyTuXmlCam(BAN), "ABCDE");
    assert.equal(boKyTuXmlCam("Báo giá\tquý 3\r\n😀 xong"), "Báo giá\tquý 3\r\n😀 xong");
    assert.equal(boKyTuXmlCam(cc(0x80, 0x9f)), cc(0x80, 0x9f), "C1 hợp lệ trong XML 1.0");
  });

  it("lamSachChuTaiLieu đi sâu vào mảng/object, giữ nguyên số và cấu trúc", () => {
    const ra = lamSachChuTaiLieu({ a: [BAN, 3, { b: BAN, c: true, d: null }] });
    assert.deepEqual(ra, { a: ["ABCDE", 3, { b: "ABCDE", c: true, d: null }] });
  });
});

describe("renderer: chữ có ký tự XML cấm vẫn ra file mở được", () => {
  it("docx - mọi loại block + tiêu đề", async () => {
    const zip = await renderDocx(
      [
        { type: "heading", text: BAN, level: 1 },
        { type: "paragraph", text: `**${BAN}** sau` },
        { type: "bullets", items: [BAN] },
        { type: "table", headers: [BAN], rows: [[BAN]] },
        { type: "two_columns", left: [BAN], right: [BAN] },
      ],
      { title: BAN },
    );
    await kiemMoiFileXml(zip);
    assert.ok((await readZipEntryText(zip, "word/document.xml")).includes("ABCDE"), "chữ hợp lệ phải còn nguyên");
  });

  it("xlsx - tên sheet, tiêu đề, header, ô chữ, ghi chú", async () => {
    const sheet: Sheet = {
      name: `Sổ${BAN}`,
      title: BAN,
      subtitle: BAN,
      headers: [BAN],
      rows: [[{ kind: "text", value: BAN }]],
      note: BAN,
    };
    const zip = await renderXlsx([sheet]);
    await kiemMoiFileXml(zip);
    assert.ok((await readZipEntryText(zip, "xl/sharedStrings.xml")).includes("ABCDE"));
  });
});
