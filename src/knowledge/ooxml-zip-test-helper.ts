import crypto from "node:crypto";
import zlib from "node:zlib";

/**
 * Trợ giúp dựng file zip TAY cho test đọc OOXML an toàn. KHÔNG dùng ở code
 * chạy thật - dựng zip tay (thay vì gọi `renderDocx`/`renderXlsx`) để tạo
 * được các ca biên mà bộ sinh của repo KHÔNG BAO GIỜ ghi (bom, entry vượt
 * trần, XML lồng sâu) - xem `read-zip-entry.test.ts` cho lý do gốc của cách
 * dựng zip tay này (offset từng trường phải khớp CHÍNH XÁC với những gì
 * `read-zip-entry.ts`/`zip-stream-entry.ts` đọc).
 */

const WORDML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SPREADSHEETML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

type ZipEntryInput = { name: string; data: Buffer };
/** Entry đã NÉN SẴN - dùng khi nhiều entry cùng nội dung để khỏi gọi
 * `deflateRawSync` lặp lại trên CÙNG một khối byte (xem `buildZipBufferTaiSuDungNen`). */
type ZipEntryNenSan = { name: string; compressed: Buffer; uncompSize: number };

/** Ráp local section + central section cho MỘT entry đã nén - dùng chung bởi
 * `buildZipBuffer` (tự nén) và `buildZipBufferTaiSuDungNen` (nén sẵn, tái dùng). */
function raponMotEntry(
  entry: ZipEntryNenSan,
  offset: number,
): { local: Buffer; central: Buffer } {
  const { name, compressed, uncompSize } = entry;
  const nameBuf = Buffer.from(name, "utf-8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(8, 8); // method = deflate
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(uncompSize, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const local = Buffer.concat([localHeader, nameBuf, compressed]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(uncompSize, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt32LE(offset, 42);
  const central = Buffer.concat([centralHeader, nameBuf]);

  return { local, central };
}

function goiZip(entries: ZipEntryNenSan[]): Buffer {
  const localSections: Buffer[] = [];
  const centralSections: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const { local, central } = raponMotEntry(entry, offset);
    localSections.push(local);
    centralSections.push(central);
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralSections);
  const localTotal = Buffer.concat(localSections);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localTotal.length, 16);

  return Buffer.concat([localTotal, centralDirectory, eocd]);
}

/** Zip tối thiểu, NHIỀU entry - mở rộng bản 1-entry của `read-zip-entry.test.ts` */
export function buildZipBuffer(entries: ZipEntryInput[]): Buffer {
  return goiZip(
    entries.map(({ name, data }) => ({
      name,
      compressed: zlib.deflateRawSync(data),
      uncompSize: data.length,
    })),
  );
}

/**
 * NHIỀU entry CÙNG NỘI DUNG (`data`) nhưng KHÁC TÊN (`tenCacEntry`) - nén
 * MỘT LẦN rồi tái dùng, thay vì gọi `deflateRawSync` lặp lại trên CÙNG một
 * khối byte cho từng entry như `buildZipBuffer` sẽ làm. Dùng cho fixture cần
 * NHIỀU entry lớn (`zipNhieuEntryVuaDu`) - đo được `deflateRawSync` trên 20
 * MB chữ khó nén tốn ~550 ms MỘT LẦN gọi; gọi lại cho mỗi tên (kiểu
 * `buildZipBuffer`) nhân phí đó lên 3-4 lần, cộng thẳng vào tổng thời gian
 * `pnpm test`.
 *
 * `level: 1` (nén NHANH NHẤT, không phải nén TỐT NHẤT): đo được giảm ~20%
 * thời gian (551 -> 437 ms trên 20 MB) mà tỉ lệ nén hầu như không đổi (1,85
 * so với 1,84) - test chỉ cần tỉ lệ ĐỦ THẤP để không chạm chốt tỉ lệ 500:1,
 * không cần nén tốt nhất. Chỉ dùng ở đây (fixture test), KHÔNG áp cho
 * `buildZipBuffer` dùng chung - giữ hành vi nén mặc định cho mọi caller khác.
 */
export function buildZipBufferTaiSuDungNen(data: Buffer, tenCacEntry: string[]): Buffer {
  const compressed = zlib.deflateRawSync(data, { level: 1 });
  return goiZip(tenCacEntry.map((name) => ({ name, compressed, uncompSize: data.length })));
}

/**
 * Gói 1 fragment XML thành `word/document.xml` hợp lệ VỀ MẶT NAMESPACE - bắt
 * buộc khai `xmlns:w=...` ở gốc, không thì `saxes` (chế độ `xmlns: true`) ném
 * "unbound namespace prefix" ngay ở thẻ `<w:...>` ĐẦU TIÊN, che mất chính cơ
 * chế cần kiểm (bộ đếm độ sâu) - đây là bẫy đã phát hiện lúc viết test.
 */
export function docxTuXml(fragment: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORDML_NS}"><w:body>${fragment}</w:body></w:document>`;
  return buildZipBuffer([{ name: "word/document.xml", data: Buffer.from(documentXml, "utf-8") }]);
}

/**
 * Chữ KHÓ NÉN (hex của byte ngẫu nhiên) - dùng cho fixture cần cỡ giải nén
 * LỚN mà KHÔNG được vượt trần TỈ LỆ NÉN (500:1, xem `ooxml-limits.ts`). Nội
 * dung lặp 1 ký tự (`"x".repeat(...)`) nén tới hơn 1000:1 (**đo thật: 1
 * MB "x" lặp -> 1033 byte, tỉ lệ 1015:1**) - sau khi sửa chốt tỉ lệ để miễn
 * kiểm theo OUTPUT (không phải theo cỡ nén đầu vào), fixture kiểu đó sẽ bị
 * CHÍNH chốt tỉ lệ bắt trước khi chạm tới chốt entry/tổng cần đo - che mất
 * đường code cần kiểm. Hex của byte ngẫu nhiên nén được **1,85:1** (đo thật:
 * 1 MB hex -> 568.244 byte) - 16 giá trị byte trong bảng chữ vẫn còn dư thừa
 * hơn byte ngẫu nhiên thuần, nhưng xa dưới trần 500:1.
 */
export function chuKhoNen(soByte: number): string {
  return crypto.randomBytes(Math.ceil(soByte / 2)).toString("hex").slice(0, soByte);
}

/** docx chỉ có 1 đoạn rỗng (không `<w:t>` nào) - mô phỏng file chỉ chứa ảnh */
export function docxChiCoAnh(): Buffer {
  return docxTuXml('<w:p><w:r><w:drawing/></w:r></w:p>');
}

/** Entry `word/document.xml` giải nén ra vượt trần MỘT entry (32 MB) */
export function zipEntryQuaTran(): Buffer {
  const raw = Buffer.alloc(33 * 1024 * 1024, 0x41); // nén cực tốt (toàn 'A') - test nhanh
  return buildZipBuffer([{ name: "word/document.xml", data: raw }]);
}

/**
 * xlsx-shaped: `sharedStrings.xml` + 3 sheet, MỖI entry đều DƯỚI trần entry
 * (32 MB) nhưng TỔNG vượt trần archive (64 MB) - đúng ca trần theo entry bỏ
 * lọt mà trần tổng phải bắt được. MỖI entry là XML ĐÃ ĐÓNG THẺ ĐẦY ĐỦ
 * (`<sst><si><t>...chữ...</t></si></sst>`) VỚI CHỮ KHÓ NÉN (`chuKhoNen`) -
 * cố ý, có BA bẫy nếu làm khác:
 * 1. Byte ngẫu nhiên THÔ (không lồng trong thẻ): saxes chặn CÚ PHÁP ngay ở
 *    chunk đầu (~16 KB, cỡ buffer nội bộ zlib) - che mất bộ cộng dồn cần đo.
 * 2. Để thẻ KHÔNG đóng: entry đầu (dưới cả 2 trần) đọc xong hết mới tới
 *    `parser.close()` báo "unclosed tag" - che mất bộ cộng dồn vì test
 *    không bao giờ chạy tới entry thứ 3-4 (nơi tổng vượt 64 MB).
 * 3. Chữ LẶP 1 KÝ TỰ nén tới hơn 1000:1 - CHÍNH chốt tỉ lệ (đã sửa để miễn
 *    kiểm theo OUTPUT) sẽ bắt fixture này trước khi chạm chốt cần đo.
 * Đóng thẻ đầy đủ + chữ khó nén thì 3 entry đầu qua trót lọt (20+20+20=60 MB,
 * dưới 64 MB, tỉ lệ nén 1,85:1 dưới xa 500:1), entry thứ 4 mới chạm trần
 * tổng - đúng đường code cần đo.
 *
 * Dùng `buildZipBufferTaiSuDungNen` (nén MỘT LẦN, tái dùng cho 4 tên) thay
 * `buildZipBuffer` (tự nén lại 4 lần cho CÙNG 20 MB dữ liệu - đo được cộng
 * gần 3 giây vào tổng thời gian `pnpm test`).
 */
export function zipNhieuEntryVuaDu(): Buffer {
  const noiDung = `<sst><si><t>${chuKhoNen(20 * 1024 * 1024)}</t></si></sst>`;
  const moiEntry = Buffer.from(noiDung, "utf-8");
  return buildZipBufferTaiSuDungNen(moiEntry, [
    "xl/sharedStrings.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
    "xl/worksheets/sheet3.xml",
  ]);
}

/** xlsx toàn ô rỗng tự đóng - không sharedStrings, không giá trị nào đọc được */
export function xlsxRong(): Buffer {
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${SPREADSHEETML_NS}"><sheetData><row r="1"><c r="A1" s="1"/><c r="B1" s="1"/></row></sheetData></worksheet>`;
  return buildZipBuffer([
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1, "utf-8") },
  ]);
}

/**
 * xlsx với `xl/worksheets/sheet1.xml` + `sharedStrings.xml` TỰ VIẾT TAY (không
 * qua exceljs) - cần cho ca ô tự đóng nằm Ở CUỐI HÀNG, không có ô nào phía sau
 * để "cơ chế lấp cột theo ô kế tiếp" tình cờ che lấp mất chỗ hỏng. Xem
 * `extract-xlsx-text.test.ts` - test dùng hàm này để cô lập ĐÚNG nhánh xử lý ô
 * tự đóng, không lẫn với nhánh lấp cột (hai nhánh khác nhau, dễ nhầm lẫn khi
 * chỉ thử với ô tự đóng nằm GIỮA hàng như fixture Excel thật).
 */
export function xlsxTuSheetVaChuoi(sheet1Body: string, sharedStrings: string[]): Buffer {
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${SPREADSHEETML_NS}" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${SPREADSHEETML_NS}"><sheetData>${sheet1Body}</sheetData></worksheet>`;
  return buildZipBuffer([
    { name: "xl/sharedStrings.xml", data: Buffer.from(sst, "utf-8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1, "utf-8") },
  ]);
}
