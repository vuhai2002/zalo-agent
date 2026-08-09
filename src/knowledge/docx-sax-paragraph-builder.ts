import type { SaxesTagNS } from "saxes";
import type { XmlSaxHandlers } from "../shared/xml-sax-scan.js";
import { TRAN_TONG_KY_TU_TRICH } from "./ooxml-limits.js";

/**
 * State machine đọc `word/document.xml` qua sự kiện SAX, thay
 * `PARAGRAPH_RE`/`RUN_TEXT_RE` cũ - xem mục 3.1 báo cáo nghiên cứu cho từng
 * ca biên (tab stop trong `w:pPr` so với trong `w:r`, `<w:p/>` tự đóng, bảng
 * giữ cấu trúc hàng, heading qua `w:outlineLvl`).
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/**
 * Vào các thẻ này thì NGỪNG coi text bên trong là nội dung đoạn văn - đây là
 * thuộc tính/định dạng, không phải chữ người đọc thấy. `<w:tab/>` trong
 * `w:pPr><w:tabs>` là ĐỊNH NGHĨA điểm dừng tab (không phải ký tự tab thật)
 * nên cũng bị bỏ qua nhờ nằm trong `pPr`, không cần liệt kê riêng "tabs".
 */
const THE_BO_QUA_NOI_DUNG = new Set(["pPr", "rPr", "tblPr", "tcPr", "trPr", "sectPr"]);

function giaTriThuocTinh(tag: SaxesTagNS, localName: string): string | undefined {
  for (const key in tag.attributes) {
    if (tag.attributes[key]?.local === localName) return tag.attributes[key]!.value;
  }
  return undefined;
}

/** "Heading2" / "Heading 2" / "heading 2"... -> 2. undefined nếu không khớp.
 * Word ghi styleId PascalCase không dấu cách ("Heading2"); w:name trong
 * styles.xml (không đọc ở phase này) dùng "heading 2" thường có dấu cách -
 * trim+lowercase+bỏ khoảng trắng bắt được cả hai kiểu bằng một regex. */
function capTuStyleId(styleId: string): number | undefined {
  const chuan = styleId.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^heading([1-9])$/.exec(chuan);
  return m ? Number(m[1]) : undefined;
}

export type DocxSaxBuilder = XmlSaxHandlers & {
  /** Danh sách "đoạn" cuối cùng - mỗi phần tử là 1 đoạn văn hoặc 1 bảng (đã
   * gộp hàng bằng "\n"), heading đã đổi thành tiền tố markdown "#". */
  layDoanVanBan(): string[];
};

export function taoDocxSaxBuilder(): DocxSaxBuilder {
  const doan: string[] = [];
  let tongKyTu = 0;

  let boQuaNoiDung = 0; // >0: đang trong pPr/rPr/tblPr/tcPr/trPr/sectPr (mọi cấp lồng)
  let dangTrongRunText = false; // đang trong <w:t> - CHỈ text ở đây mới là nội dung

  let boDemDoanVan = ""; // buffer đoạn văn hiện tại (ngoài bảng)
  let capTieuDe: number | undefined; // từ pStyle (tầng 3)
  let outlineLvl: number | undefined; // từ w:outlineLvl (tầng 1, ưu tiên hơn)

  let hangCuaBang: string[] = []; // mỗi phần tử = 1 hàng đã join " | "
  let oCuaHang: string[] = [];
  let dangTrongO = false;
  let boDemO = ""; // gom nhiều <w:p> trong cùng 1 <w:tc>

  function themDoan(text: string): void {
    if (!text) return;
    tongKyTu += text.length;
    if (tongKyTu > TRAN_TONG_KY_TU_TRICH) {
      throw new Error(
        `Chữ trích ra từ file vượt quá giới hạn ${TRAN_TONG_KY_TU_TRICH / (1024 * 1024)} MB`,
      );
    }
    doan.push(text);
  }

  function ketThucDoanVan(): void {
    const vanBan = boDemDoanVan.trim();
    if (dangTrongO) {
      if (vanBan) boDemO += (boDemO ? " " : "") + vanBan;
    } else if (vanBan) {
      // outlineLvl 0-based (0 = Heading1) - tầng 1 BỀN hơn pStyle bản địa hoá
      const cap = outlineLvl !== undefined ? outlineLvl + 1 : capTieuDe;
      themDoan(cap ? `${"#".repeat(Math.min(cap, 9))} ${vanBan}` : vanBan);
    }
    boDemDoanVan = "";
    capTieuDe = undefined;
    outlineLvl = undefined;
  }

  const moThe: XmlSaxHandlers["moThe"] = (tag) => {
    if (tag.uri !== W_NS) return; // bỏ qua drawing/mc/... - chỉ quan tâm wordprocessingml
    const ten = tag.local;

    if (THE_BO_QUA_NOI_DUNG.has(ten)) {
      boQuaNoiDung++;
      return;
    }
    if (boQuaNoiDung > 0) {
      // Vẫn phải đọc pStyle/outlineLvl DÙ đang trong pPr - đây chính là nơi
      // chúng khai báo. Mọi thẻ khác trong vùng "bỏ qua nội dung" bị lơ.
      if (ten === "pStyle") {
        const val = giaTriThuocTinh(tag, "val");
        if (val !== undefined) capTieuDe = capTuStyleId(val);
      } else if (ten === "outlineLvl") {
        const val = giaTriThuocTinh(tag, "val");
        if (val !== undefined) outlineLvl = Number(val);
      }
      return;
    }

    switch (ten) {
      case "p":
        boDemDoanVan = "";
        capTieuDe = undefined;
        outlineLvl = undefined;
        break;
      case "t":
        dangTrongRunText = true;
        break;
      case "tab":
        boDemDoanVan += "\t"; // chỉ tới được đây khi KHÔNG trong pPr - đúng là tab thật trong w:r
        break;
      case "br":
      case "cr":
        boDemDoanVan += "\n";
        break;
      case "noBreakHyphen":
        boDemDoanVan += "-";
        break;
      case "tbl":
        hangCuaBang = [];
        break;
      case "tr":
        oCuaHang = [];
        break;
      case "tc":
        dangTrongO = true;
        boDemO = "";
        break;
    }
  };

  const dongThe: XmlSaxHandlers["dongThe"] = (tag) => {
    if (tag.uri !== W_NS) return;
    const ten = tag.local;

    if (THE_BO_QUA_NOI_DUNG.has(ten)) {
      boQuaNoiDung--;
      return;
    }
    if (boQuaNoiDung > 0) return;

    switch (ten) {
      case "t":
        dangTrongRunText = false;
        break;
      case "p":
        ketThucDoanVan();
        break;
      case "tc":
        oCuaHang.push(boDemO.trim());
        dangTrongO = false;
        break;
      case "tr":
        if (oCuaHang.some((o) => o.trim())) hangCuaBang.push(oCuaHang.join(" | "));
        break;
      case "tbl":
        if (hangCuaBang.length > 0) themDoan(hangCuaBang.join("\n"));
        break;
    }
  };

  const chuVanBan: XmlSaxHandlers["chuVanBan"] = (text) => {
    // `<w:delText>` (chữ đã xoá, track changes) và `<w:instrText>` (mã field)
    // KHÔNG khớp local name "t" nên tự động bị loại - không cần lọc riêng.
    if (dangTrongRunText && boQuaNoiDung === 0) boDemDoanVan += text;
  };

  return {
    moThe,
    dongThe,
    chuVanBan,
    layDoanVanBan: () => doan,
  };
}
