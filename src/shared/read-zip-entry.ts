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

/**
 * Trần dữ liệu ĐÃ GIẢI NÉN của một entry - chặn "zip bomb". Tỉ lệ nén deflate
 * có thể tới cỡ 1000:1, nên một file nén hợp lệ về magic bytes (`PK`) và nhỏ
 * hơn trần dung lượng UPLOAD vẫn có thể giải ra hàng GB, cấp phát Buffer
 * TRƯỚC khi bất kỳ trần dung lượng nào (KB_MAX_FILE_MB, tới 100 MB) kịp chặn.
 * Lỗi cấu trúc zip thì an toàn (ném RangeError, bắt được), nhưng thiếu trần
 * này thì OOM giết cả process - không bắt được, mất luôn mọi account đang
 * chạy chung tiến trình.
 *
 * 300 MB = 3 lần trần file lớn nhất Kho tri thức cho phép (100 MB) - đủ rộng
 * cho docx/xlsx thật (không tài liệu nào giải nén ra quá vài chục MB) mà vẫn
 * đủ nhỏ để không tự đâm OOM: bot tự host, thường chạy VPS 1-4 GB, nên trần
 * phải nằm trong ngân sách RAM thật của máy, không chỉ "hữu hạn về lý
 * thuyết" (5000 MB cũ vẫn đủ để kernel OOM-killer bắn tiến trình trước khi
 * zlib kịp ném lỗi trên một máy nhỏ). Hằng số CỐ ĐỊNH, không đọc trực tiếp từ
 * tuning KB_MAX_FILE_MB: module này còn phục vụ đường GHI tài liệu của bot
 * (docx/xlsx tự sinh, xem `render-docx.ts`/`render-xlsx.ts` và test của
 * chúng) - kéo cấu hình DB của riêng Kho tri thức vào một tiện ích dùng
 * chung là ghép sai tầng, và sẽ buộc mọi test gọi hàm này phải mở DB thật
 * (xem "Bẫy khi viết test" ở CLAUDE.md).
 *
 * Hai giới hạn của cơ chế này, cần nhớ để không tưởng nó chặn được nhiều hơn
 * thực tế:
 * - Trần áp theo TỪNG ENTRY, không phải theo cả file zip - hàm này (và
 *   `readZipEntryText`/`listZipEntries`) không có khái niệm "phiên đọc" nên
 *   không cộng dồn được nhiều lời gọi. Nhánh ĐỌC của Kho tri thức (đọc
 *   `sharedStrings.xml` CỘNG mọi `sheetN.xml`) không còn đi qua các hàm này -
 *   xem `zip-stream-entry.ts` (dùng lại `centralEntries` xuất ở dưới) cho
 *   trần TỔNG cả archive. Ba hàm ở file này giữ nguyên hành vi một-lần-một-
 *   entry, phục vụ đường GHI của bot (`render-docx.ts`/`render-xlsx.ts`) và
 *   test đọc ngược nội dung đã ghi.
 * - `maxOutputLength` của zlib kiểm THEO TỪNG CHUNK trong lúc giải nén (không
 *   phải trần cấp phát trước), nên bộ nhớ đỉnh vẫn có thể chạm gần tới trần
 *   này trước khi `inflateRawSync` kịp ném lỗi - trần này giảm rủi ro OOM,
 *   không loại bỏ hẳn.
 */
const TRAN_GIAI_NEN_MAC_DINH = 300 * 1024 * 1024;

export type CentralEntry = {
  name: string;
  method: number;
  compSize: number;
  /** Kích thước SAU giải nén theo khai báo của central directory - KHÔNG
   * đáng tin tuyệt đối (spec cho phép khai gian), chỉ dùng để từ chối SỚM
   * trước khi giải nén; caller vẫn phải đếm byte thật trong lúc giải nén. */
  uncompSize: number;
  localOffset: number;
};

/**
 * Duyệt central directory - export cho `zip-stream-entry.ts` dùng lại (đọc
 * theo luồng kèm trần tổng), tránh viết trùng logic parse central directory
 * đã đúng và đã kiểm chứng ở đây.
 */
export function* centralEntries(buf: Buffer): Generator<CentralEntry> {
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
      uncompSize: buf.readUInt32LE(off + 24),
      localOffset: buf.readUInt32LE(off + 42),
    };
    off += 46 + nameLen + extraLen + commentLen;
  }
}

/**
 * Dữ liệu NÉN thô của 1 entry (chưa giải nén) - cắt theo LOCAL header vì độ
 * dài name/extra ở đó có thể khác central directory. Export cho
 * `zip-stream-entry.ts` dùng lại: đường đọc theo luồng cần chính lát cắt này
 * để đưa vào `zlib.createInflateRaw()` thay vì `inflateRawSync` một phát.
 */
export function duLieuNenCuaEntry(buf: Buffer, entry: CentralEntry): Buffer {
  const nameLen = buf.readUInt16LE(entry.localOffset + 26);
  const extraLen = buf.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  return buf.subarray(start, start + entry.compSize);
}

/**
 * Nội dung entry đã giải nén, hoặc null nếu không có entry tên đó.
 *
 * @param maxOutputBytes trần dữ liệu SAU giải nén - mặc định `TRAN_GIAI_NEN_MAC_DINH`.
 * Tham số hóa để test dựng được ca vượt trần với một con số nhỏ, không cần
 * dựng bomb thật hàng GB.
 */
export function readZipEntry(
  buf: Buffer,
  entryName: string,
  maxOutputBytes: number = TRAN_GIAI_NEN_MAC_DINH,
): Buffer | null {
  for (const entry of centralEntries(buf)) {
    if (entry.name !== entryName) continue;
    const data = duLieuNenCuaEntry(buf, entry);
    if (entry.method === 0) return data;
    try {
      // maxOutputLength làm zlib kiểm dung lượng NGAY TRONG LÚC giải nén, ném
      // lỗi sớm thay vì cấp phát bộ nhớ tới khi OOM (không bắt được).
      return zlib.inflateRawSync(data, { maxOutputLength: maxOutputBytes });
    } catch (err) {
      if (err instanceof RangeError && (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        throw new Error(
          `Entry "${entryName}" giải nén ra vượt quá giới hạn an toàn (nghi ngờ zip bomb) - đã chặn trước khi giải nén hết`,
        );
      }
      throw err;
    }
  }
  return null;
}

/** Đọc entry dạng chuỗi UTF-8; ném lỗi nếu không có (test cần biết ngay) */
export function readZipEntryText(
  buf: Buffer,
  entryName: string,
  maxOutputBytes: number = TRAN_GIAI_NEN_MAC_DINH,
): string {
  const data = readZipEntry(buf, entryName, maxOutputBytes);
  if (!data) throw new Error(`Không tìm thấy "${entryName}" trong file`);
  return data.toString("utf-8");
}

export function listZipEntries(buf: Buffer): string[] {
  return [...centralEntries(buf)].map((e) => e.name);
}
