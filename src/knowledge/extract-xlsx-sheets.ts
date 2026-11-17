import { quetXmlTheoLuong } from "../shared/xml-sax-scan.js";
import { moPhienDocZip } from "../shared/zip-stream-entry.js";
import { taoSharedStringsSaxBuilder } from "./xlsx-sax-shared-strings.js";
import { taoXlsxSheetSaxBuilder, type NganSachO, type OXlsx } from "./xlsx-sax-sheet-builder.js";
import { docDanhSachSheet, type HienThiSheet } from "./xlsx-workbook-sheets.js";

export type { OXlsx } from "./xlsx-sax-sheet-builder.js";

export type SheetDaDoc = { ten: string; hienThi: HienThiSheet; hang: OXlsx[][] };

/**
 * Đọc xlsx theo SHEET, giữ tên sheet thật, trạng thái ẩn và kiểu từng ô.
 *
 * Sheet `veryHidden` (người dùng Excel thường không mở ra được) KHÔNG được
 * đọc nội dung - trả `hang: []` để caller vẫn biết nó tồn tại mà đếm/báo.
 *
 * Mọi sheet dùng CHUNG một phiên giải nén (trần tổng của archive) và một sổ
 * ngân sách ô/ký tự - chia nhỏ ra nhiều sheet không lách được trần tổng
 * (xem `NganSachO`). Module thuần, chạy được trong tiến trình con.
 */
export async function extractXlsxSheets(buf: Buffer): Promise<SheetDaDoc[]> {
  const phien = moPhienDocZip(buf);
  const entries = phien.danhSachEntry();

  // Workbook chỉ toàn số (không ô chữ nào) thì Excel bỏ hẳn sharedStrings.xml
  let chuoiDungChung: readonly string[] = [];
  if (entries.includes("xl/sharedStrings.xml")) {
    const ssBuilder = taoSharedStringsSaxBuilder();
    await quetXmlTheoLuong(phien.docEntryTheoLuong("xl/sharedStrings.xml"), ssBuilder);
    chuoiDungChung = ssBuilder.layChuoiDungChung();
  }

  const danhSach = await docDanhSachSheet(phien, entries);
  if (danhSach.length === 0) throw new Error("File xlsx không có sheet nào đọc được");

  const nganSachO: NganSachO = { tongO: 0, tongKyTu: 0 };
  const ketQua: SheetDaDoc[] = [];
  for (const s of danhSach) {
    if (s.hienThi === "an-han") {
      ketQua.push({ ten: s.ten, hienThi: s.hienThi, hang: [] });
      continue;
    }
    const builder = taoXlsxSheetSaxBuilder(chuoiDungChung, nganSachO);
    await quetXmlTheoLuong(phien.docEntryTheoLuong(s.file), builder);
    ketQua.push({ ten: s.ten, hienThi: s.hienThi, hang: builder.layCacHang() });
  }
  return ketQua;
}
