import { quetXmlTheoLuong } from "../shared/xml-sax-scan.js";
import { moPhienDocZip } from "../shared/zip-stream-entry.js";
import { taoSharedStringsSaxBuilder } from "./xlsx-sax-shared-strings.js";
import { taoXlsxSheetSaxBuilder, type NganSachO } from "./xlsx-sax-sheet-builder.js";

/**
 * `sharedStrings.xml` + các `xl/worksheets/sheetN.xml` -> chữ theo HÀNG.
 *
 * Cắt theo HÀNG, không theo ô: một hàng là một bản ghi có nghĩa (tên hàng |
 * giá | bảo hành). Gộp cả sheet thành một khối chữ là mất cấu trúc, tách
 * từng ô là mất quan hệ giữa các ô cùng hàng.
 *
 * Viết trên SAX (`xlsx-sax-shared-strings.ts`, `xlsx-sax-sheet-builder.ts`)
 * qua luồng giải nén có trần TỔNG dùng chung một `PhienDocZip` cho mọi entry
 * đọc trong hàm này - đây chính là chỗ bắt được ca mà trần theo TỪNG entry bỏ
 * lọt: `sharedStrings.xml` CỘNG mọi `sheetN.xml` có thể mỗi cái đều dưới trần
 * entry mà tổng vẫn vượt trần archive. Thay hẳn `CELL_RE`/`T_TAG_RE` cũ - xem
 * mục 1.3 báo cáo nghiên cứu (ô rỗng tự đóng nuốt ô kế tiếp, lộ index
 * sharedString thành số vô nghĩa).
 */
export async function extractXlsxText(buf: Buffer): Promise<string> {
  const phien = moPhienDocZip(buf);
  const entries = phien.danhSachEntry();

  // Workbook chỉ toàn số (không ô chữ nào) thì Excel bỏ hẳn sharedStrings.xml
  let chuoiDungChung: readonly string[] = [];
  if (entries.includes("xl/sharedStrings.xml")) {
    const ssBuilder = taoSharedStringsSaxBuilder();
    await quetXmlTheoLuong(phien.docEntryTheoLuong("xl/sharedStrings.xml"), ssBuilder);
    chuoiDungChung = ssBuilder.layChuoiDungChung();
  }

  // Đọc theo THỨ TỰ FILE (sheet1.xml, sheet2.xml, ...) - xấp xỉ chấp nhận
  // được: kho tri thức cần đọc HẾT nội dung, không cần đúng tuyệt đối thứ tự
  // hiển thị nếu người dùng đã kéo sắp xếp lại sheet trong Excel.
  const sheetFiles = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (sheetFiles.length === 0) {
    throw new Error("File xlsx không có sheet nào đọc được");
  }

  // Dùng CHUNG một sổ ngân sách cho MỌI sheet, trên CẢ HAI trục (số ô cấp
  // phát VÀ số ký tự trích ra) - chia nhỏ ra nhiều sheet, mỗi sheet dưới trần,
  // không được lách trần tổng (đúng nguyên tắc "trần tổng" đã áp cho
  // zip-stream-entry.ts). Trục `tongKyTu` từng bị bỏ sót: nó nằm trong thân
  // builder, mà builder được tạo LẠI mỗi sheet - xem `NganSachO`.
  const nganSachO: NganSachO = { tongO: 0, tongKyTu: 0 };
  const doanTheoSheet: string[] = [];
  for (const file of sheetFiles) {
    // moPhienDocZip/docEntryTheoLuong đã ném lỗi tiếng Việt đọc được khi vượt
    // bất kỳ trần nào - không cần bọc thêm lớp lỗi ở đây.
    const sheetBuilder = taoXlsxSheetSaxBuilder(chuoiDungChung, nganSachO);
    await quetXmlTheoLuong(phien.docEntryTheoLuong(file), sheetBuilder);
    const dong = sheetBuilder.layCacDong();
    if (dong.length > 0) doanTheoSheet.push(dong.join("\n"));
  }

  const ketQua = doanTheoSheet.join("\n\n");
  if (!ketQua.trim()) {
    // Trả chuỗi rỗng thì worker đánh dấu "san_sang, 0 đoạn" - xem lý do đầy
    // đủ ở `extract-docx-text.ts` (cùng nguyên tắc, áp cho xlsx).
    throw new Error("Không đọc được chữ nào từ file xlsx (có thể mọi ô đều trống)");
  }
  return ketQua;
}
