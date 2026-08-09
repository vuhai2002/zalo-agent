import zlib from "node:zlib";
import { centralEntries, duLieuNenCuaEntry } from "./read-zip-entry.js";
import {
  LoiVuotTran,
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

/**
 * Ba câu thông báo cho "vượt trần vì TO/NHIỀU", KHÔNG dùng chữ "nghi ngờ zip
 * bomb" - đó là buộc tội một file có thể hoàn toàn hợp lệ. Ca số entry vượt
 * 256 CŨNG thuộc nhóm này: một .docx nhiều ảnh (mỗi ảnh một entry) đạt 257
 * entry với khoảng 250 ảnh - hoàn toàn có thật, corpus đo cao nhất 99 chỉ
 * chứng minh corpus không có file ảnh nặng, không chứng minh 257 là bất
 * thường. Chữ "zip bomb" CHỈ dành cho ca hình dạng bất thường THẬT SỰ (tỉ lệ
 * nén phi thực tế) - xem nhánh kiểm tỉ lệ trong `docEntryTheoLuong`.
 */
function loiVuotTranMotEntry(): LoiVuotTran {
  return new LoiVuotTran(
    `File này quá lớn để xử lý (một phần bên trong giải nén ra vượt quá giới hạn ${formatMB(TRAN_MOT_ENTRY)} cho một phần). Hãy rút gọn nội dung hoặc tách thành nhiều file nhỏ hơn.`,
  );
}
function loiVuotTranTong(): LoiVuotTran {
  return new LoiVuotTran(
    `File này quá lớn để xử lý (tổng nội dung bên trong giải nén ra vượt quá giới hạn ${formatMB(TRAN_TONG_GIAI_NEN)}). Hãy rút gọn nội dung hoặc tách thành nhiều file nhỏ hơn.`,
  );
}
function loiVuotTranSoEntry(soEntry: number): LoiVuotTran {
  return new LoiVuotTran(
    `File này có quá nhiều phần bên trong (${soEntry}, trần là ${TRAN_SO_ENTRY}). Hãy gộp lại hoặc tách thành nhiều file nhỏ hơn.`,
  );
}

export function moPhienDocZip(buf: Buffer): PhienDocZip {
  const entries = [...centralEntries(buf)];
  if (entries.length > TRAN_SO_ENTRY) throw loiVuotTranSoEntry(entries.length);

  let tongByteDaGiaiNen = 0;

  function kiemTranByte(byteEntry: number): void {
    if (byteEntry > TRAN_MOT_ENTRY) throw loiVuotTranMotEntry();
    if (tongByteDaGiaiNen > TRAN_TONG_GIAI_NEN) throw loiVuotTranTong();
  }

  async function* docEntryTheoLuong(entryName: string): AsyncGenerator<string> {
    const entry = entries.find((e) => e.name === entryName);
    if (!entry) throw new Error(`Không tìm thấy "${entryName}" trong file`);

    // Từ chối SỚM theo kích thước KHAI BÁO trong central directory - rẻ,
    // nhưng KHÔNG đáng tin tuyệt đối (spec cho phép khai gian), nên vòng lặp
    // dưới vẫn phải đếm byte THẬT trong lúc giải nén, không chỉ dựa vào đây.
    if (entry.uncompSize > TRAN_MOT_ENTRY) throw loiVuotTranMotEntry();
    if (tongByteDaGiaiNen + entry.uncompSize > TRAN_TONG_GIAI_NEN) throw loiVuotTranTong();

    const compData = duLieuNenCuaEntry(buf, entry);

    if (entry.method === 0) {
      // STORED - không nén, kích thước thật CHÍNH LÀ compData.length
      tongByteDaGiaiNen += compData.length;
      kiemTranByte(compData.length);
      yield compData.toString("utf-8");
      return;
    }

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
        kiemTranByte(byteEntry);

        // Miễn kiểm tỉ lệ khi CHƯA ĐỌC ĐỦ ngưỡng OUTPUT (byteEntry, KHÔNG
        // phải cỡ nén compData.length đầu vào) - đúng cách Apache POI làm
        // (ZipSecureFile.MIN_INFLATE_RATIO: chưa đọc đủ 100 KiB OUTPUT thì
        // chưa xét tỉ lệ). Bản trước đây miễn theo compData.length (cỡ NÉN)
        // khiến chốt này thành code chết: với entry 32 MB / miễn dưới 1 MB
        // nén, để tỉ lệ vượt 500 MÀ còn đủ lớn để không miễn (>= 1 MB nén)
        // thì phần giải nén phải > 500 MB - lúc đó trần MỘT entry (32 MB) đã
        // chặn từ lâu, tỉ lệ không bao giờ kịp là chốt đầu tiên. Miễn theo
        // OUTPUT thì bom-1mb.docx thật (1,7 KB nén -> 1 MB, tỉ lệ ~596:1) bị
        // bắt NGAY ở mốc 1 MB output - đúng con số nghiên cứu đo, xem test.
        if (byteEntry >= TRAN_MIEN_KIEM_TI_LE && byteEntry > compData.length * TI_LE_NEN_TOI_DA) {
          // Tỉ lệ nén phi thực tế LÀ hình dạng khả nghi thật (OOXML thật cao
          // nhất đo được 50,2x; máy sinh thoái hoá tới 292,9x) - giữ chữ
          // "nghi ngờ zip bomb".
          throw new LoiVuotTran(
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
