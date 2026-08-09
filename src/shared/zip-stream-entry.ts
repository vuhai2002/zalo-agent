import zlib from "node:zlib";
import { centralEntries, duLieuNenCuaEntry } from "./read-zip-entry.js";
import {
  TI_LE_NEN_TOI_DA,
  TRAN_MIEN_KIEM_TI_LE,
  TRAN_MOT_ENTRY,
  TRAN_SO_ENTRY,
  TRAN_TONG_GIAI_NEN,
} from "../knowledge/ooxml-limits.js";

/**
 * Đọc entry trong file zip THEO LUỒNG, thay `readZipEntryText` cho nhánh đọc
 * OOXML của Kho tri thức (docx/xlsx) - `read-zip-entry.ts` KHÔNG đổi, vẫn
 * phục vụ đường GHI của bot với hành vi một-lần-một-entry cũ.
 *
 * Khác biệt cốt lõi so với `readZipEntry`: không bao giờ dựng một `Buffer`
 * hay `string` chứa TRỌN VẸN nội dung đã giải nén. Nạp thẳng từng chunk từ
 * `zlib.createInflateRaw()` ra ngoài, đếm byte NGAY TRONG LÚC giải nén, và
 * `destroy()` stream sớm khi vượt trần - đỉnh RSS chỉ còn cỡ trần đặt ra,
 * không phải cỡ dữ liệu bom khai báo. Đo trên `document.xml` 7,13 MB thật:
 * `inflateRawSync` một phát +210 MB RSS so với streaming+cắt sớm chỉ +13 MB.
 *
 * Một PHIÊN (`PhienDocZip`) dùng chung MỘT bộ đếm tổng cho mọi entry đọc
 * trong phiên đó - đây là chỗ bắt được ca `extract-xlsx-text.ts` đọc
 * `sharedStrings.xml` CỘNG mọi `sheetN.xml`: từng entry riêng lẻ có thể đều
 * dưới trần entry mà tổng vẫn vượt trần archive.
 */

export type PhienDocZip = {
  /** Tên mọi entry trong archive - đã kiểm số lượng, không cần giải nén gì */
  danhSachEntry(): string[];
  /**
   * Chuỗi chunk UTF-8 đã giải nén của 1 entry, đếm dồn vào TỔNG của phiên.
   * Ném lỗi tiếng Việt ngay khi vượt bất kỳ trần nào - có thể ném GIỮA
   * chừng vòng lặp (sau khi đã yield vài chunk đầu), caller (xml-sax-scan.ts)
   * phải để throw đó truyền thẳng ra ngoài, không nuốt.
   */
  docEntryTheoLuong(entryName: string): AsyncGenerator<string>;
};

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export function moPhienDocZip(buf: Buffer): PhienDocZip {
  const entries = [...centralEntries(buf)];
  if (entries.length > TRAN_SO_ENTRY) {
    throw new Error(
      `File zip có ${entries.length} entry, vượt quá giới hạn ${TRAN_SO_ENTRY} entry - nghi ngờ zip bomb`,
    );
  }

  let tongByteDaGiaiNen = 0;

  function kiemTranByte(entryName: string, byteEntry: number): void {
    if (byteEntry > TRAN_MOT_ENTRY) {
      throw new Error(
        `Entry "${entryName}" giải nén ra vượt quá giới hạn ${formatMB(TRAN_MOT_ENTRY)} - nghi ngờ zip bomb`,
      );
    }
    if (tongByteDaGiaiNen > TRAN_TONG_GIAI_NEN) {
      throw new Error(
        `Tổng dữ liệu giải nén của file vượt quá giới hạn ${formatMB(TRAN_TONG_GIAI_NEN)} - nghi ngờ zip bomb`,
      );
    }
  }

  async function* docEntryTheoLuong(entryName: string): AsyncGenerator<string> {
    const entry = entries.find((e) => e.name === entryName);
    if (!entry) throw new Error(`Không tìm thấy "${entryName}" trong file`);

    // Từ chối SỚM theo kích thước KHAI BÁO trong central directory - rẻ,
    // nhưng KHÔNG đáng tin tuyệt đối (spec cho phép khai gian), nên vòng lặp
    // dưới vẫn phải đếm byte THẬT trong lúc giải nén, không chỉ dựa vào đây.
    if (entry.uncompSize > TRAN_MOT_ENTRY) {
      throw new Error(
        `Entry "${entryName}" khai kích thước giải nén ${formatMB(entry.uncompSize)}, vượt quá giới hạn ${formatMB(TRAN_MOT_ENTRY)} - nghi ngờ zip bomb`,
      );
    }
    if (tongByteDaGiaiNen + entry.uncompSize > TRAN_TONG_GIAI_NEN) {
      throw new Error(
        `Tổng dữ liệu giải nén của file vượt quá giới hạn ${formatMB(TRAN_TONG_GIAI_NEN)} - nghi ngờ zip bomb`,
      );
    }

    const compData = duLieuNenCuaEntry(buf, entry);

    if (entry.method === 0) {
      // STORED - không nén, kích thước thật CHÍNH LÀ compData.length
      tongByteDaGiaiNen += compData.length;
      kiemTranByte(entryName, compData.length);
      yield compData.toString("utf-8");
      return;
    }

    // Tỉ lệ nén tính trên byte NÉN thật (compData.length, không phải khai báo
    // compSize - hai giá trị luôn khớp vì cùng đọc từ central directory,
    // nhưng dùng compData.length rõ ràng hơn về việc đây là dữ liệu đưa vào
    // inflate). Miễn kiểm nếu nén ra dưới TRAN_MIEN_KIEM_TI_LE - entry nhỏ
    // nhiễu mạnh và không đe doạ gì dù tỉ lệ cao.
    //
    // Ghi chú đã kiểm bằng test (xem zip-stream-entry.test.ts): với đúng 3
    // con số hiện tại (entry 32 MB / tỉ lệ 500 / miễn kiểm dưới 1 MB), chốt
    // này KHÔNG BAO GIỜ là chốt chặn đầu tiên cho MỘT entry đơn - muốn tỉ lệ
    // vượt 500 mà phần nén còn đủ lớn để không bị miễn kiểm (>= 1 MB) thì
    // phần giải nén phải > 500 MB, lúc đó `kiemTranByte` (trần MỘT entry, 32
    // MB) đã ném từ lâu. Giữ lại vì đây là con số brief yêu cầu (phòng khi
    // sau này trần entry được nới lỏng), không phải vì đã đo được nó bắt
    // thêm được ca nào ngoài trần entry với bộ số hiện tại.
    const mienKiemTiLe = compData.length < TRAN_MIEN_KIEM_TI_LE;

    const inflate = zlib.createInflateRaw();
    inflate.setEncoding("utf8"); // StringDecoder tự đệm byte dở ở ranh giới chunk - tiếng Việt an toàn
    inflate.end(compData);

    let byteEntry = 0;
    try {
      for await (const raw of inflate) {
        // setEncoding("utf8") ở trên đảm bảo mọi chunk là string thật (StringDecoder
        // tự đệm byte dở ở ranh giới) - nhưng type của Readable#asyncIterator vẫn
        // khai `any` (Node chưa có overload theo encoding lúc chạy), ép kiểu tường
        // minh ở đúng ranh giới đã được đảm bảo đúng lúc runtime này.
        const chunk = raw as string;
        const bytes = Buffer.byteLength(chunk, "utf8");
        byteEntry += bytes;
        tongByteDaGiaiNen += bytes;
        kiemTranByte(entryName, byteEntry);
        if (!mienKiemTiLe && byteEntry > compData.length * TI_LE_NEN_TOI_DA) {
          throw new Error(
            `Entry "${entryName}" có tỉ lệ nén vượt quá ${TI_LE_NEN_TOI_DA}:1 - nghi ngờ zip bomb`,
          );
        }
        yield chunk;
      }
    } finally {
      inflate.destroy();
    }
  }

  return {
    danhSachEntry: () => entries.map((e) => e.name),
    docEntryTheoLuong,
  };
}
