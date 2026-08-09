import type { SaxesTagNS } from "saxes";
import type { XmlSaxHandlers } from "../shared/xml-sax-scan.js";
import { thayTheEscapeExcel } from "./xlsx-sax-shared-strings.js";
import { TRAN_TONG_KY_TU_TRICH } from "./ooxml-limits.js";

/**
 * `xl/worksheets/sheetN.xml` -> chữ theo HÀNG, cắt theo hàng như comment gốc
 * của file này đã ghi: "một hàng là một bản ghi có nghĩa". Thay
 * `ROW_RE`/`CELL_RE`/`V_RE` cũ - xem mục 1.3 và 3.2 báo cáo nghiên cứu.
 */

const SPREADSHEETML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function giaTriThuocTinh(tag: SaxesTagNS, localName: string): string | undefined {
  for (const key in tag.attributes) {
    if (tag.attributes[key]?.local === localName) return tag.attributes[key]!.value;
  }
  return undefined;
}

/** "B" -> 2, "AA" -> 27 (chỉ số cột 1-based, kiểu Excel). */
function chuCotThanhChiSo(chuCai: string): number {
  let idx = 0;
  for (const c of chuCai) idx = idx * 26 + (c.charCodeAt(0) - 64); // 'A' = 65
  return idx;
}

export type XlsxSheetSaxBuilder = XmlSaxHandlers & {
  layCacDong(): string[];
};

/** @param chuoiDungChung mảng `sharedStrings.xml` theo ĐÚNG thứ tự index */
export function taoXlsxSheetSaxBuilder(chuoiDungChung: readonly string[]): XlsxSheetSaxBuilder {
  const cacDong: string[] = [];
  let tongKyTu = 0;

  let dongHienTai: string[] = [];
  let cotKyVong = 1; // chỉ số cột (1-based) mong đợi ô KẾ TIẾP sẽ nằm ở đó

  let kieuO: string | undefined; // thuộc tính t= của <c> đang mở
  let chiSoCotHienTai = 1;
  let boDemV = "";
  let boDemIs = "";
  let dangTrongV = false;
  let dangTrongF = false; // <f>...</f> là CÔNG THỨC, không phải giá trị - luôn bỏ qua
  let dangTrongIs = false;
  let dangTrongTTrongIs = false;
  let doSauRPh = 0; // phiên âm furigana trong <is> - loại như sharedStrings

  function giaTriOTheoLoai(): string {
    if (kieuO === "s") return thayTheEscapeExcel(chuoiDungChung[Number(boDemV)] ?? "");
    if (kieuO === "inlineStr") return thayTheEscapeExcel(boDemIs);
    if (kieuO === "str") return thayTheEscapeExcel(boDemV); // kết quả công thức dạng chữ
    if (kieuO === "b") return boDemV === "1" ? "Đúng" : "Sai";
    return boDemV; // "e" (lỗi công thức), hoặc không khai t= (số thường)
  }

  /** Chèn ô rỗng cho cột bị nhảy cóc (ô rỗng hẳn Excel bỏ khỏi XML, hoặc ô có
   * định dạng nhưng tự đóng) - không thì ô sau dính sát ô trước, lệch cột. */
  function themOVaoDong(giaTri: string, chiSoCot: number): void {
    while (dongHienTai.length < chiSoCot - 1) dongHienTai.push("");
    dongHienTai[chiSoCot - 1] = giaTri;
    cotKyVong = chiSoCot + 1;
  }

  function chiSoCotCua(tag: SaxesTagNS): number {
    const chuCai = giaTriThuocTinh(tag, "r")?.match(/^[A-Za-z]+/)?.[0];
    return chuCai ? chuCotThanhChiSo(chuCai.toUpperCase()) : cotKyVong;
  }

  const moThe: XmlSaxHandlers["moThe"] = (tag) => {
    if (tag.uri !== SPREADSHEETML_NS) return;
    switch (tag.local) {
      case "row":
        dongHienTai = [];
        cotKyVong = 1;
        break;
      case "c":
        kieuO = giaTriThuocTinh(tag, "t");
        chiSoCotHienTai = chiSoCotCua(tag);
        boDemV = "";
        boDemIs = "";
        if (tag.isSelfClosing) themOVaoDong("", chiSoCotHienTai); // ô có định dạng nhưng rỗng
        break;
      case "v":
        dangTrongV = true;
        break;
      case "f":
        dangTrongF = true;
        break;
      case "is":
        dangTrongIs = true;
        break;
      case "rPh":
        if (dangTrongIs) doSauRPh++;
        break;
      case "t":
        if (dangTrongIs && doSauRPh === 0) dangTrongTTrongIs = true;
        break;
    }
  };

  const dongThe: XmlSaxHandlers["dongThe"] = (tag) => {
    if (tag.uri !== SPREADSHEETML_NS) return;
    switch (tag.local) {
      case "row":
        if (dongHienTai.some((o) => o.trim())) {
          const dong = dongHienTai.join(" | ");
          tongKyTu += dong.length;
          if (tongKyTu > TRAN_TONG_KY_TU_TRICH) {
            throw new Error(
              `Chữ trích ra từ file vượt quá giới hạn ${TRAN_TONG_KY_TU_TRICH / (1024 * 1024)} MB`,
            );
          }
          cacDong.push(dong);
        }
        break;
      case "c":
        if (!tag.isSelfClosing) themOVaoDong(giaTriOTheoLoai(), chiSoCotHienTai);
        break;
      case "v":
        dangTrongV = false;
        break;
      case "f":
        dangTrongF = false;
        break;
      case "is":
        dangTrongIs = false;
        break;
      case "rPh":
        if (dangTrongIs) doSauRPh--;
        break;
      case "t":
        dangTrongTTrongIs = false;
        break;
    }
  };

  const chuVanBan: XmlSaxHandlers["chuVanBan"] = (text) => {
    if (dangTrongF) return; // <f> luôn bỏ qua - chuỗi công thức, không phải giá trị
    if (dangTrongV) boDemV += text;
    else if (dangTrongTTrongIs) boDemIs += text;
  };

  return { moThe, dongThe, chuVanBan, layCacDong: () => cacDong };
}
