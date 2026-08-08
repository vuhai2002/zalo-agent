import { decodeHtmlEntities } from "../shared/html-entities.js";
import { listZipEntries, readZipEntryText } from "../shared/read-zip-entry.js";

/**
 * `sharedStrings.xml` + các `xl/worksheets/sheetN.xml` -> chữ theo HÀNG.
 *
 * Cắt theo HÀNG, không theo ô: một hàng là một bản ghi có nghĩa (tên hàng |
 * giá | bảo hành). Gộp cả sheet thành một khối chữ là mất cấu trúc, tách
 * từng ô là mất quan hệ giữa các ô cùng hàng.
 */

const T_TAG_RE = /<t[^>]*>([\s\S]*?)<\/t>/g;
const SI_RE = /<si>([\s\S]*?)<\/si>/g;
const ROW_RE = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
// Ô có thể tự đóng (<c r="A1" s="1"/> - rỗng) hoặc có nội dung (<c ...><v>..</v></c>)
const CELL_RE = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
const V_RE = /<v>([\s\S]*?)<\/v>/;

/** Danh sách chuỗi dùng chung theo ĐÚNG thứ tự index mà ô kiểu t="s" tham chiếu tới */
function docChuoiDungChung(xml: string): string[] {
  const ra: string[] = [];
  for (const si of xml.matchAll(SI_RE)) {
    let chu = "";
    // Chuỗi rich-text (vd marker **đậm**) tách thành nhiều <t> lồng trong
    // nhiều <r> - gom hết lại vẫn ra đúng chữ, bất kể có lồng <r> hay không.
    for (const t of si[0]!.matchAll(T_TAG_RE)) chu += t[1];
    ra.push(decodeHtmlEntities(chu));
  }
  return ra;
}

/** Giá trị hiển thị của 1 ô, dựa theo kiểu khai trong thuộc tính `t` */
function giaTriO(attrs: string, inner: string | undefined, chuoiDungChung: string[]): string {
  if (inner === undefined) return ""; // ô tự đóng - rỗng

  const kieu = /\st="([^"]*)"/.exec(attrs)?.[1] ?? "n"; // không khai t = số thường

  if (kieu === "s") {
    const idx = Number(V_RE.exec(inner)?.[1] ?? -1);
    return decodeHtmlEntities(chuoiDungChung[idx] ?? "");
  }
  if (kieu === "inlineStr") {
    let chu = "";
    for (const t of inner.matchAll(T_TAG_RE)) chu += t[1];
    return decodeHtmlEntities(chu);
  }
  // "str" (kết quả công thức dạng chữ), "b" (boolean), hoặc số thường - và cả
  // Ô CÔNG THỨC (chứa thêm <f>...</f> phía trước) - V_RE chỉ bắt <v>, luôn ra
  // đúng GIÁ TRỊ ĐÃ TÍNH chứ không phải chuỗi công thức.
  return decodeHtmlEntities(V_RE.exec(inner)?.[1] ?? "");
}

export async function extractXlsxText(buf: Buffer): Promise<string> {
  const entries = listZipEntries(buf);

  // Workbook chỉ toàn số (không ô chữ nào) thì Excel bỏ hẳn sharedStrings.xml
  const chuoiDungChung = entries.includes("xl/sharedStrings.xml")
    ? docChuoiDungChung(readZipEntryText(buf, "xl/sharedStrings.xml"))
    : [];

  // Đọc theo THỨ TỰ FILE (sheet1.xml, sheet2.xml, ...) - xấp xỉ chấp nhận
  // được: kho tri thức cần đọc HẾT nội dung, không cần đúng tuyệt đối thứ tự
  // hiển thị nếu người dùng đã kéo sắp xếp lại sheet trong Excel.
  const sheetFiles = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (sheetFiles.length === 0) {
    throw new Error("File xlsx không có sheet nào đọc được");
  }

  const doanTheoSheet: string[] = [];
  for (const file of sheetFiles) {
    const xml = readZipEntryText(buf, file);
    const dong: string[] = [];
    for (const row of xml.matchAll(ROW_RE)) {
      const oTrongDong = [...row[1]!.matchAll(CELL_RE)].map((c) =>
        giaTriO(c[1] ?? "", c[2], chuoiDungChung),
      );
      if (oTrongDong.some((o) => o.trim())) dong.push(oTrongDong.join(" | "));
    }
    if (dong.length > 0) doanTheoSheet.push(dong.join("\n"));
  }

  return doanTheoSheet.join("\n\n");
}
