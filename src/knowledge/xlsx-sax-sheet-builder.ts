import type { SaxesTagNS } from "saxes";
import type { XmlSaxHandlers } from "../shared/xml-sax-scan.js";
import { thayTheEscapeExcel } from "./xlsx-sax-shared-strings.js";
import { LoiVuotTran, TRAN_SO_COT_EXCEL, TRAN_TONG_KY_TU_TRICH, TRAN_TONG_SO_O } from "./ooxml-limits.js";

/** Bộ đếm CÔNG CẤP PHÁT (ô thật + ô đệm) dùng CHUNG cho MỌI sheet của cùng 1
 * file xlsx - `extract-xlsx-text.ts` tạo MỘT lần, truyền vào từng
 * `taoXlsxSheetSaxBuilder()` (như `zip-stream-entry.ts` dùng 1 phiên cho
 * trần tổng). KHÔNG dùng biến module-level: mỗi `docChuTuFile` cần bộ riêng. */
export type NganSachO = { tongO: number };

/** `xl/worksheets/sheetN.xml` -> chữ theo HÀNG (một hàng là một bản ghi có
 * nghĩa). Thay `ROW_RE`/`CELL_RE`/`V_RE` cũ - xem mục 1.3, 3.2 nghiên cứu. */

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

/**
 * @param chuoiDungChung mảng `sharedStrings.xml` theo ĐÚNG thứ tự index
 * @param nganSachO bộ đếm công cấp phát DÙNG CHUNG với các sheet khác trong
 * cùng file - xem `NganSachO`.
 */
export function taoXlsxSheetSaxBuilder(
  chuoiDungChung: readonly string[],
  nganSachO: NganSachO,
): XlsxSheetSaxBuilder {
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
    if (kieuO === "s") {
      // Ô t="s" nhưng KHÔNG có <v> (hoặc <v></v> rỗng) - boDemV === "" thì
      // Number("") === 0, LỘ RA chuỗi tại index 0 của người khác thay vì ô
      // rỗng. Đã đo: '<c t="s"><v>1</v></c><c t="s"></c>' ra "That | BI-MAT" -
      // ô B trống bịa ra chữ của ô A. Phải kiểm rỗng TRƯỚC khi Number().
      if (boDemV.trim() === "") return "";
      return thayTheEscapeExcel(chuoiDungChung[Number(boDemV)] ?? "");
    }
    if (kieuO === "inlineStr") return thayTheEscapeExcel(boDemIs);
    if (kieuO === "str") return thayTheEscapeExcel(boDemV); // kết quả công thức dạng chữ
    if (kieuO === "b") return boDemV === "1" ? "Đúng" : "Sai";
    return boDemV; // "e" (lỗi công thức), hoặc không khai t= (số thường)
  }

  /**
   * Chèn ô rỗng cho cột bị nhảy cóc (ô rỗng hẳn Excel bỏ khỏi XML, hoặc ô có
   * định dạng nhưng tự đóng) - không thì ô sau dính sát ô trước, lệch cột.
   *
   * BẮT BUỘC đếm CÔNG CẤP PHÁT (ô đệm + chính ô này) TRƯỚC vòng lặp `push`,
   * bất kể hàng có chữ hay không: hàng toàn ô rỗng bị lọc bỏ ở `</row>`
   * TRƯỚC khi cộng vào `tongKyTu`, nên `TRAN_TONG_KY_TU_TRICH` không bắt
   * được ca này. `TRAN_SO_COT_EXCEL` chỉ chặn MỘT lần gọi phình to, không
   * chặn NHIỀU HÀNG lặp lại - xem `TRAN_TONG_SO_O` cho số đo cụ thể.
   */
  function themOVaoDong(giaTri: string, chiSoCot: number): void {
    // Math.max(1, ...) - KHÔNG BAO GIỜ hoàn quỹ. `dongHienTai` reset mỗi
    // <row> nhưng `nganSachO.tongO` thì KHÔNG (cố ý, dùng chung cả sheet) -
    // để hiệu ÂM cộng thẳng vào (ô cột THẤP đứng SAU ô cột CAO cùng hàng, vd
    // <c r="XFD1"/><c r="A1"/>) thì một khoản "hoàn quỹ" giả xoá sạch chi phí
    // CPU thật của push vừa chạy khỏi sổ. Đã đo: 100.000 hàng hình dạng đó
    // chạy đủ 20 giây mà KHÔNG trần nào bắt (tongO cuối chỉ = 100.000, mỗi
    // hàng "net" +1 dù tốn 16.383 lần push CPU). Kẹp sàn 1: mỗi lần gọi
    // charge = max(1, số push thật + 1) >= số push thật, nên tongO tích luỹ
    // LUÔN là biên trên của tổng push CPU thật - không thể lách bằng bất kỳ
    // thứ tự cột nào.
    const soOThemVao = Math.max(1, chiSoCot - dongHienTai.length);
    nganSachO.tongO += soOThemVao;
    if (nganSachO.tongO > TRAN_TONG_SO_O) {
      throw new LoiVuotTran(
        `File xlsx có quá nhiều ô để xử lý (kể cả ô trống do cột nhảy cóc), vượt quá giới hạn ${TRAN_TONG_SO_O.toLocaleString("vi-VN")} ô. Hãy rút gọn bảng tính hoặc tách thành nhiều file nhỏ hơn.`,
      );
    }
    while (dongHienTai.length < chiSoCot - 1) dongHienTai.push("");
    dongHienTai[chiSoCot - 1] = giaTri;
    cotKyVong = chiSoCot + 1;
  }

  function chiSoCotCua(tag: SaxesTagNS): number {
    const chuCai = giaTriThuocTinh(tag, "r")?.match(/^[A-Za-z]+/)?.[0];
    if (!chuCai) return cotKyVong;
    const chiSo = chuCotThanhChiSo(chuCai.toUpperCase());
    // BẮT BUỘC kẹp: cột thật tối đa của Excel là XFD = 16.384. Không kẹp thì
    // themOVaoDong() cấp phát mảng theo chiSo KHÔNG TRẦN - r="AAAAAAA1" (7
    // chữ cái) ra hơn 321 TRIỆU, khiến vòng lặp lấp cột cấp một mảng 321
    // triệu phần tử -> OOM FATAL của V8 (giết hẳn process, không try/catch
    // bắt được). Không trần zip/entry/tổng/độ-sâu nào ở trên bắt được ca này.
    if (chiSo > TRAN_SO_COT_EXCEL) {
      throw new LoiVuotTran(
        `File xlsx có ô ở cột vượt quá giới hạn thật của Excel (cột tối đa là XFD, tức ${TRAN_SO_COT_EXCEL}) - nghi ngờ file bị chỉnh sửa bất thường`,
      );
    }
    return chiSo;
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
            throw new LoiVuotTran(
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
