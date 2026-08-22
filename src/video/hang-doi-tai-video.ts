/**
 * Hàng đợi giới hạn số việc chạy CÙNG LÚC.
 *
 * VÌ SAO CẦN - số đo trên tiến trình Python thật:
 *
 *   yt-dlp chỉ metadata : 72,8 MB RAM đỉnh
 *   yt-dlp tải video 5MB: 75,6 MB RAM đỉnh
 *
 * RAM gần như KHÔNG đổi giữa hai ca, tức ~73 MB là bản thân Python + yt-dlp,
 * và chi phí đó CỐ ĐỊNH mỗi tiến trình chứ không theo cỡ video. Nên nút thắt
 * không phải băng thông như tưởng ban đầu, mà là RAM: song song 4 là ~300 MB,
 * song song 6 là ~450 MB - quá nhiều cho một VPS còn chạy app khác.
 *
 * Người dùng chốt: **2 chạy cùng lúc, còn lại xếp hàng**.
 *
 * VÌ SAO KHÔNG DÙNG `enqueueSend`: cái đó xếp hàng theo TỪNG THREAD để tin nhắn
 * của một cuộc trò chuyện ra đúng thứ tự. Đây là bài toán khác hẳn - giới hạn
 * TỔNG số tiến trình nặng trên cả máy, không phân biệt thread. Hai người khác
 * thread vẫn phải xếp hàng với nhau.
 */

type ViecCho = {
  chay: () => Promise<unknown>;
  xong: (v: unknown) => void;
  hong: (e: unknown) => void;
};

let dangChay = 0;
const dangCho: ViecCho[] = [];

/**
 * Trần song song, do NGƯỜI GỌI truyền vào mỗi lần xếp hàng.
 *
 * VÌ SAO KHÔNG ĐỌC CẤU HÌNH TRỰC TIẾP Ở ĐÂY: `getTuning` kéo theo
 * `database.js`, mà module đó mở SQLite ngay lúc nạp - test của hàng đợi sẽ mở
 * nhầm DB thật.
 *
 * VÌ SAO KHÔNG DÙNG SETTER TOÀN CỤC (`datTranSongSong` lúc khởi động): quên gọi
 * là hỏng CÂM - hàng đợi chạy với số mặc định, người dùng chỉnh trên dashboard
 * mà không thấy gì đổi, và không có gì báo. Bản đầu của file này đúng là đã
 * quên nối. Truyền vào mỗi lần gọi thì trình biên dịch canh hộ.
 */
let tranHienTai = 2;

function chayTiep(): void {
  if (dangChay >= Math.max(1, tranHienTai)) return;
  const viec = dangCho.shift();
  if (!viec) return;

  dangChay++;
  // `Promise.resolve().then(...)` chứ KHÔNG gọi `viec.chay()` trần: `dangChay++`
  // đã chạy rồi, nên nếu `chay()` ném ĐỒNG BỘ thì chuỗi `.then().finally()`
  // không bao giờ được dựng và `dangChay--` không bao giờ chạy - suất rò VĨNH
  // VIỄN. Đo được: 2 lần ném đồng bộ là hàng đợi kẹt hẳn, mọi lượt tải sau đó
  // treo mãi, kéo theo cả lượt agent treo và khóa thread không nhả.
  //
  // Hôm nay caller truyền hàm `async` (không thể ném đồng bộ) nên chưa chạm
  // tới được, nhưng nó cách đúng một lần refactor "bỏ chữ async cho gọn".
  Promise.resolve()
    .then(() => viec.chay())
    .then(viec.xong, viec.hong)
    .finally(() => {
      dangChay--;
      // Gọi lại ở đây chứ không dựa vào lời gọi kế tiếp: việc cuối cùng xong mà
      // không ai đánh thức hàng đợi thì mọi việc đang chờ treo vĩnh viễn.
      chayTiep();
    });
}

/**
 * Xếp một việc vào hàng, chờ tới lượt rồi chạy.
 *
 * Lỗi của `viec` được ném NGUYÊN VẸN ra ngoài - hàng đợi không nuốt lỗi, vì
 * caller cần biết vì sao hỏng để nói lại cho người dùng.
 */
export function xepHangTaiVideo<T>(viec: () => Promise<T>, tranSongSong: number): Promise<T> {
  // Cập nhật mỗi lần xếp hàng: đổi trên dashboard là lời gọi kế tiếp ăn ngay,
  // không cần khởi động lại bot.
  tranHienTai = tranSongSong;
  return new Promise<T>((resolve, reject) => {
    dangCho.push({
      chay: viec,
      xong: resolve as (v: unknown) => void,
      hong: reject,
    });
    chayTiep();
  });
}

/** Số việc đang chạy và đang chờ - để tool nói "đang bận, xếp thứ N" */
export function trangThaiHangDoi(): { dangChay: number; dangCho: number } {
  return { dangChay, dangCho: dangCho.length };
}

/** Chỉ dùng cho test - dọn sạch trạng thái giữa các ca */
export function resetHangDoiTaiVideo(): void {
  dangChay = 0;
  dangCho.length = 0;
  tranHienTai = 2;
}
