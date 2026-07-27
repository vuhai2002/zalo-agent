import zlib from "node:zlib";

/**
 * Đọc 1 entry trong file zip (dùng cho .docx/.xlsx - đều là zip chứa XML).
 *
 * BẮT BUỘC đi qua CENTRAL DIRECTORY, không đọc theo local file header: có thư
 * viện ghi zip kiểu streaming, để `compSize = 0` ở local header (flag bit 3,
 * kích thước thật nằm ở data descriptor SAU dữ liệu). Đọc theo local header sẽ
 * ra dữ liệu RỖNG - và test dựa vào đó sẽ xanh một cách vô nghĩa vì không có gì
 * để so. Central directory luôn có kích thước thật.
 *
 * Tự viết bằng node:zlib để không thêm dependency chỉ để giải nén.
 */

const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;

type CentralEntry = { name: string; method: number; compSize: number; localOffset: number };

function* centralEntries(buf: Buffer): Generator<CentralEntry> {
  const eocd = buf.lastIndexOf(EOCD_SIGNATURE);
  if (eocd < 0) throw new Error("Không phải file zip hợp lệ (thiếu End Of Central Directory)");

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error("Central directory hỏng");
    }
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    yield {
      name: buf.subarray(off + 46, off + 46 + nameLen).toString("utf-8"),
      method: buf.readUInt16LE(off + 10),
      compSize: buf.readUInt32LE(off + 20),
      localOffset: buf.readUInt32LE(off + 42),
    };
    off += 46 + nameLen + extraLen + commentLen;
  }
}

/** Nội dung entry đã giải nén, hoặc null nếu không có entry tên đó */
export function readZipEntry(buf: Buffer, entryName: string): Buffer | null {
  for (const entry of centralEntries(buf)) {
    if (entry.name !== entryName) continue;
    // Độ dài name/extra ở LOCAL header có thể khác central - phải đọc lại từ đó
    const nameLen = buf.readUInt16LE(entry.localOffset + 26);
    const extraLen = buf.readUInt16LE(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + entry.compSize);
    return entry.method === 0 ? data : zlib.inflateRawSync(data);
  }
  return null;
}

/** Đọc entry dạng chuỗi UTF-8; ném lỗi nếu không có (test cần biết ngay) */
export function readZipEntryText(buf: Buffer, entryName: string): string {
  const data = readZipEntry(buf, entryName);
  if (!data) throw new Error(`Không tìm thấy "${entryName}" trong file`);
  return data.toString("utf-8");
}

export function listZipEntries(buf: Buffer): string[] {
  return [...centralEntries(buf)].map((e) => e.name);
}
