import type { XmlSaxHandlers } from "../shared/xml-sax-scan.js";

/**
 * `xl/sharedStrings.xml` -> mảng chuỗi ĐÚNG THỨ TỰ index mà ô kiểu `t="s"`
 * tham chiếu tới. Thay `SI_RE`/`T_TAG_RE` cũ.
 */

const SPREADSHEETML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/**
 * Excel escape riêng cho ký tự điều khiển trong chuỗi (ví dụ xuống dòng
 * trong ô) - quy ước của Excel nằm NGAY TRONG dữ liệu chữ, parser XML không
 * đụng tới (đây không phải entity XML), bộ đọc phải tự thay.
 */
export function thayTheEscapeExcel(s: string): string {
  return s.replaceAll("_x000D_", "\n");
}

export type SharedStringsSaxBuilder = XmlSaxHandlers & {
  layChuoiDungChung(): string[];
};

export function taoSharedStringsSaxBuilder(): SharedStringsSaxBuilder {
  const chuoiDungChung: string[] = [];
  let doSauRPh = 0; // >0: đang trong <rPh> (phiên âm furigana) - KHÔNG tính vào chữ
  let dangTrongT = false;
  let boDem = "";

  const moThe: XmlSaxHandlers["moThe"] = (tag) => {
    if (tag.uri !== SPREADSHEETML_NS) return;
    switch (tag.local) {
      case "si":
        boDem = "";
        break;
      case "rPh":
        doSauRPh++;
        break;
      case "t":
        if (doSauRPh === 0) dangTrongT = true;
        break;
    }
  };

  const dongThe: XmlSaxHandlers["dongThe"] = (tag) => {
    if (tag.uri !== SPREADSHEETML_NS) return;
    switch (tag.local) {
      case "si":
        chuoiDungChung.push(thayTheEscapeExcel(boDem));
        break;
      case "rPh":
        doSauRPh--;
        break;
      case "t":
        dangTrongT = false;
        break;
    }
  };

  const chuVanBan: XmlSaxHandlers["chuVanBan"] = (text) => {
    // Chuỗi rich-text (marker **đậm** của render-xlsx.ts) tách thành nhiều
    // <r><t> lồng trong 1 <si> - gom hết <t> không phải rPh là ra đúng chữ,
    // bất kể có lồng <r> hay không.
    if (dangTrongT) boDem += text;
  };

  return { moThe, dongThe, chuVanBan, layChuoiDungChung: () => chuoiDungChung };
}
