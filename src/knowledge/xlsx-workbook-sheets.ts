import path from "node:path";
import type { SaxesTagNS } from "saxes";
import { quetXmlTheoLuong } from "../shared/xml-sax-scan.js";
import type { PhienDocZip } from "../shared/zip-stream-entry.js";

/**
 * Danh sách sheet của workbook THEO THỨ TỰ HIỂN THỊ, kèm tên thật và trạng
 * thái ẩn - đọc `xl/workbook.xml` + `xl/_rels/workbook.xml.rels`.
 *
 * Thiếu một trong hai file (tệp tự dựng, công cụ lạ) thì lùi về cách cũ: đọc
 * `xl/worksheets/sheetN.xml` theo số thứ tự file, tên "Sheet N", coi như hiện.
 */

export type HienThiSheet = "hien" | "an" | "an-han";
export type SheetTrongWorkbook = { ten: string; hienThi: HienThiSheet; file: string };

const SPREADSHEETML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

function thuocTinh(tag: SaxesTagNS, local: string, uri = ""): string | undefined {
  for (const key in tag.attributes) {
    const a = tag.attributes[key]!;
    if (a.local === local && a.uri === uri) return a.value;
  }
  return undefined;
}

function theoThuTuFile(entries: string[]): SheetTrongWorkbook[] {
  return entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((file, i) => ({ ten: `Sheet ${i + 1}`, hienThi: "hien", file }));
}

/**
 * Target trong rels tương đối với thư mục `xl/` (nơi `workbook.xml` nằm), hoặc
 * tuyệt đối từ gốc gói nếu bắt đầu bằng "/". Chuẩn hóa `./` và `../` (OPC cho
 * phép `../xl/worksheets/sheet1.xml`) - không thì trỏ vào tên không tồn tại.
 */
function duongDanTuTarget(target: string): string {
  const day = target.startsWith("/") ? target.slice(1) : path.posix.join("xl", target);
  return path.posix.normalize(day).replace(/^\/+/, "");
}

export async function docDanhSachSheet(phien: PhienDocZip, entries: string[]): Promise<SheetTrongWorkbook[]> {
  if (!entries.includes("xl/workbook.xml") || !entries.includes("xl/_rels/workbook.xml.rels")) {
    return theoThuTuFile(entries);
  }

  const khaiBao: { ten: string; hienThi: HienThiSheet; rid: string }[] = [];
  await quetXmlTheoLuong(phien.docEntryTheoLuong("xl/workbook.xml"), {
    moThe: (tag) => {
      if (tag.uri !== SPREADSHEETML_NS || tag.local !== "sheet") return;
      const trangThai = thuocTinh(tag, "state");
      khaiBao.push({
        ten: thuocTinh(tag, "name") ?? `Sheet ${khaiBao.length + 1}`,
        hienThi: trangThai === "veryHidden" ? "an-han" : trangThai === "hidden" ? "an" : "hien",
        rid: thuocTinh(tag, "id", REL_NS) ?? "",
      });
    },
  });

  const target = new Map<string, string>();
  await quetXmlTheoLuong(phien.docEntryTheoLuong("xl/_rels/workbook.xml.rels"), {
    moThe: (tag) => {
      if (tag.uri !== PKG_REL_NS || tag.local !== "Relationship") return;
      const id = thuocTinh(tag, "Id");
      const t = thuocTinh(tag, "Target");
      if (id && t && (thuocTinh(tag, "Type") ?? "").endsWith("/worksheet")) target.set(id, duongDanTuTarget(t));
    },
  });

  // Chỉ nhận worksheet có file thật trong gói (chartsheet, rel trỏ ra ngoài thì bỏ)
  // Hai <sheet> trỏ cùng một file thì chỉ đọc một lần - không thì nội dung và
  // thống kê bị đếm hai lần
  const daCo = new Set<string>();
  const ds = khaiBao.flatMap((k) => {
    const file = target.get(k.rid);
    if (!file || !entries.includes(file) || daCo.has(file)) return [];
    daCo.add(file);
    return [{ ten: k.ten, hienThi: k.hienThi, file }];
  });
  return ds.length > 0 ? ds : theoThuTuFile(entries);
}
