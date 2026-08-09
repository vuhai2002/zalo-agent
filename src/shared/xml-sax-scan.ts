import { SaxesParser, type SaxesTagNS } from "saxes";
import { LoiVuotTran, TRAN_DO_SAU_XML } from "../knowledge/ooxml-limits.js";

/**
 * Bọc `saxes` (chế độ namespace `xmlns: true`) cho đường đọc docx/xlsx: nạp
 * luồng chunk chữ, đếm độ sâu lồng thẻ và ném lỗi tiếng Việt khi vượt trần
 * hoặc XML sai cú pháp.
 *
 * KHÔNG đăng ký handler "error" của saxes - để `fail()` của nó NÉM thẳng
 * (hành vi mặc định khi thiếu handler), thay vì âm thầm phục hồi rồi đọc
 * tiếp với dữ liệu đã hỏng. XML của người lạ thì sai cú pháp phải chặn cứng.
 *
 * Không tự viết bộ quét tuyến tính: nghiên cứu đo bộ quét `indexOf` tự chế
 * sai 5/5 ca biên (giá trị thuộc tính chứa `>`, comment, CDATA, thực thể,
 * namespace prefix lạ) - xem mục 2.1 báo cáo nghiên cứu.
 */

export type XuLyTag = (tag: SaxesTagNS) => void;

export type XmlSaxHandlers = {
  /** Gọi khi MỞ một thẻ - kể cả thẻ tự đóng (`<w:p/>`), saxes phát cả
   * `opentag` lẫn `closetag` cho thẻ tự đóng, liền nhau. */
  moThe?: XuLyTag;
  /** Gọi khi ĐÓNG một thẻ - thẻ tự đóng: gọi ngay sau `moThe`. */
  dongThe?: XuLyTag;
  /**
   * Gọi với từng mẩu text bên trong thẻ hiện tại. CÓ THỂ gọi NHIỀU LẦN cho
   * cùng một node nếu ranh giới chunk (từ zip-stream-entry.ts) cắt ngang
   * node đó - caller tự gộp cho tới khi gặp `dongThe` tương ứng, không được
   * coi một lần gọi là trọn vẹn nội dung.
   */
  chuVanBan?: (text: string) => void;
  /** CDATA - saxes phát sự kiện riêng, không đi qua `chuVanBan`. */
  cdata?: (text: string) => void;
};

function dichLoiSaxes(err: unknown): never {
  // LoiVuotTran ĐÃ là câu tiếng Việt cuối cùng (bộ đếm độ sâu ở dưới, hoặc
  // caller ném ngược từ handlers - ví dụ TRAN_TONG_KY_TU_TRICH của state
  // machine docx/xlsx) - không dịch lại lần nữa. Nhận diện bằng KIỂU LỖI,
  // không so khớp chuỗi (mong manh, chỉ bắt được đúng 1 loại trần).
  if (err instanceof LoiVuotTran) throw err;
  const goc = err instanceof Error ? err.message : String(err);
  throw new Error(`XML không hợp lệ: ${goc}`);
}

/**
 * Nạp luồng chunk (từ `zip-stream-entry.ts`) vào một `SaxesParser` mới, phát
 * lại qua `handlers`. Lỗi từ chính `chunks` (ví dụ vượt trần zip) KHÔNG đi
 * qua `dichLoiSaxes` - chỉ lỗi xảy ra TRONG `parser.write()`/`parser.close()`
 * mới bị bắt ở đây. Ba nguồn có thể ném từ bên trong đó: saxes tự ném (cú
 * pháp sai), bộ đếm độ sâu ở dưới tự ném, hoặc `handlers.moThe`/`dongThe`/
 * `chuVanBan` ném NGƯỢC LÊN (ví dụ state machine docx/xlsx phát hiện vượt
 * `TRAN_TONG_KY_TU_TRICH`/`TRAN_SO_COT_EXCEL`) - vì các handler này được gọi
 * ĐỒNG BỘ từ bên trong sự kiện saxes. `dichLoiSaxes` chỉ dịch loại thứ nhất.
 */
export async function quetXmlTheoLuong(
  chunks: AsyncIterable<string>,
  handlers: XmlSaxHandlers,
): Promise<void> {
  const parser = new SaxesParser({ xmlns: true });
  let doSau = 0;

  parser.on("opentag", (tag) => {
    doSau++;
    if (doSau > TRAN_DO_SAU_XML) {
      throw new LoiVuotTran(`XML lồng quá sâu (vượt ${TRAN_DO_SAU_XML} cấp) - nghi ngờ bom giải nén`);
    }
    handlers.moThe?.(tag);
  });
  parser.on("closetag", (tag) => {
    doSau--;
    handlers.dongThe?.(tag);
  });
  parser.on("text", (text) => handlers.chuVanBan?.(text));
  parser.on("cdata", (text) => handlers.cdata?.(text));

  for await (const chunk of chunks) {
    try {
      parser.write(chunk);
    } catch (err) {
      dichLoiSaxes(err);
    }
  }
  try {
    parser.close();
  } catch (err) {
    dichLoiSaxes(err);
  }
}
