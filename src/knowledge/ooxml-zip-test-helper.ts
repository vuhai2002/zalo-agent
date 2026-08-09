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

/** Zip tối thiểu, NHIỀU entry - mở rộng bản 1-entry của `read-zip-entry.test.ts` */
export function buildZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localSections: Buffer[] = [];
  const centralSections: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const compressed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf-8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(8, 8); // method = deflate
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localSection = Buffer.concat([localHeader, nameBuf, compressed]);
    localSections.push(localSection);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralSections.push(Buffer.concat([centralHeader, nameBuf]));

    offset += localSection.length;
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
 * lọt mà trần tổng phải bắt được.
 *
 * MỖI entry là XML ĐÃ ĐÓNG THẺ ĐẦY ĐỦ (`<sst><si><t>...chữ...</t></si></sst>`)
 * - cố ý, có HAI bẫy nếu làm khác:
 * 1. Byte NGẪU NHIÊN thay vì text hợp lệ: `saxes` chặn bằng lỗi CÚ PHÁP ngay
 *    ở chunk đầu (~16 KB, đúng cỡ buffer nội bộ của zlib) - lỗi đó che mất
 *    chính cơ chế cần kiểm (bộ cộng dồn của `zip-stream-entry.ts`).
 * 2. Để thẻ KHÔNG đóng: từng entry đọc RIÊNG một lượt `quetXmlTheoLuong`
 *    (một `SaxesParser` mới mỗi entry) - entry đầu (20 MB, dưới cả 2 trần)
 *    đọc xong hết rồi mới tới `parser.close()`, lúc đó saxes mới phát hiện
 *    "unclosed tag" - LỖI CÚ PHÁP Ở CHÍNH ENTRY ĐẦU che mất bộ cộng dồn, vì
 *    test không bao giờ chạy tới entry thứ 3-4 (nơi tổng vượt 64 MB).
 * Đóng thẻ đầy đủ thì 3 entry đầu qua trót lọt (20+20+20=60 MB, dưới 64 MB),
 * entry thứ 4 mới chạm trần tổng - đúng đường code cần đo.
 */
export function zipNhieuEntryVuaDu(): Buffer {
  const noiDung = `<sst><si><t>${"x".repeat(20 * 1024 * 1024)}</t></si></sst>`;
  const moiEntry = Buffer.from(noiDung, "utf-8");
  return buildZipBuffer([
    { name: "xl/sharedStrings.xml", data: moiEntry },
    { name: "xl/worksheets/sheet1.xml", data: moiEntry },
    { name: "xl/worksheets/sheet2.xml", data: moiEntry },
    { name: "xl/worksheets/sheet3.xml", data: moiEntry },
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
