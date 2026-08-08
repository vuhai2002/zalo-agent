import { appendMessage, setMessageImages } from "../conversation/history-store.js";
import { imagePathsOf, persistBatchImages } from "../conversation/media-store.js";
import { describeForHistory, type ParsedMessage } from "./zalo-message-parser.js";

/**
 * Ghi một tin đến vào lịch sử NGAY LÚC NHẬN, và đóng dấu id dòng lên chính tin
 * đó.
 *
 * Trước đây tin có-trả-lời được ghi ở CUỐI lượt (`message-turn-processor.ts`),
 * còn tin passive-listen thì ghi ngay. Hai đường, hai thời điểm. Đổi hết sang
 * ghi ngay lúc nhận vì ba lý do, xếp theo mức quan trọng:
 *
 *   1. THỨ TỰ. Ghi ở cuối lượt nghĩa là thứ tự trong DB là thứ tự lượt KẾT
 *      THÚC, không phải thứ tự người ta gửi. Còn nối tiếp thì hai thứ đó trùng
 *      nhau; cho lượt chạy song song (đợt sau) là lượt nhanh chen lên trước
 *      lượt chậm và lịch sử kể sai mạch chuyện.
 *   2. MẤT TIN. Lượt chết vì process bị giết giữa chừng là tin biến mất khỏi
 *      lịch sử, dù người nhắn đã nhận dấu "đã nhận".
 *   3. Bỏ được một nhánh đặc biệt: chỗ "tin bị bỏ vì hàng chờ chạm trần" vốn
 *      phải tự ghi lấy vì `processBatch` là nơi DUY NHẤT ghi cho nhánh
 *      có-trả-lời. Nay mọi tin đều đi chung một đường.
 *
 * Đánh đổi phải trả: lượt agent đọc lịch sử thì tin của CHÍNH nó đã nằm trong
 * đó. `buildTurnMessages` lọc theo `historyRowId` để model không thấy lặp hai
 * lần - đó là lý do hàm này phải đóng dấu id lên tin.
 */
export type TuyChonGhiTinDen = {
  /**
   * Tải và gắn ảnh ngay tại đây.
   *
   * `false` khi sắp có một lượt agent chạy: lượt đó tự `persistBatchImages`
   * (và AWAIT, vì `localPath` phải có trước khi dựng nội dung cho model), rồi
   * tự gắn đường dẫn vào dòng này. Bật ở cả hai chỗ là tải ảnh HAI LẦN -
   * `persistBatchImages` ghi đè cùng một đường dẫn nên vô hại về dữ liệu,
   * nhưng tốn đúng một lượt tải mạng thừa cho mỗi ảnh.
   */
  luuAnhNgay: boolean;
};

/**
 * @returns id dòng vừa ghi. Cũng gán vào `msg.historyRowId` - CỐ Ý sửa thẳng
 * object: mọi nơi cầm tin này về sau (bộ gộp, lượt agent, tin chen) đều cần
 * biết dòng nào là của nó, mà chuyền tay qua bốn tầng thì sớm muộn có tầng
 * quên chuyền.
 */
export function ghiTinDenVaoHistory(
  accountId: string,
  msg: ParsedMessage,
  { luuAnhNgay }: TuyChonGhiTinDen,
): number {
  const rowId = appendMessage(accountId, msg.threadId, {
    role: "user",
    content: describeForHistory(msg),
    senderName: msg.senderName,
    senderId: msg.senderId,
    // KHÔNG truyền `images`: lúc nhận thì chưa tải, `localPath` chưa tồn tại
    // nên giá trị luôn rỗng. Đường dẫn được gắn sau qua `ganAnhVaoHistory`.
    // Giờ NGƯỜI TA BẤM GỬI, không phải giờ chạy tới dòng này
    createdAt: msg.sentAt,
  });
  msg.historyRowId = rowId;

  if (luuAnhNgay && msg.images.length > 0) {
    // `persistBatchImages` không reject, nhưng `setMessageImages` chạm DB nên
    // vẫn phải có `.catch` - không thì thành unhandledRejection
    void persistBatchImages(accountId, [msg])
      .then(() => setMessageImages(rowId, imagePathsOf(msg.images)))
      .catch(() => {});
  }
  return rowId;
}

/**
 * Gắn đường dẫn ảnh vào các dòng đã ghi, sau khi lượt agent tải xong.
 *
 * Bỏ qua tin chưa có `historyRowId` thay vì ném: đây là bước LÀM TỐT THÊM (ảnh
 * để lượt sau xem lại), không đáng giết một lượt đang chạy tốt.
 */
export function ganAnhVaoHistory(danhSach: ParsedMessage[]): void {
  for (const msg of danhSach) {
    const paths = imagePathsOf(msg.images);
    if (msg.historyRowId !== undefined && paths.length > 0) {
      setMessageImages(msg.historyRowId, paths);
    }
  }
}
