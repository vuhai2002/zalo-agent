/**
 * Để yt-dlp TỰ TẢI video về file, thay vì lấy URL nó trả rồi tự tải.
 *
 * VÌ SAO PHẢI CÓ ĐƯỜNG NÀY - số đo trên link TikTok thật:
 *
 *   TikWM  `data.play`  -> HTTP 206, `video/mp4`   (tải được, ai cũng tải được)
 *   yt-dlp `d.url`      -> HTTP 403, `text/html`   (KHÔNG tải được)
 *
 * Cái 403 đó xảy ra ngay trên CHÍNH MÁY vừa chạy yt-dlp: URL của TikTok gắn với
 * phiên của yt-dlp, ai khác cầm cũng vô dụng, kể cả chính ta ở tiến trình sau.
 * Nên với TikTok, tầng dự phòng chỉ có giá trị nếu để yt-dlp làm cả việc tải -
 * và đo thật thì nó tải được: ra file 5.587.708 byte, header `ftyp` đúng mp4.
 *
 * KHÔNG dùng đường này khi URL còn tải được (xem `kiem-url-video-truoc-khi-gui`):
 * để máy người nhận tải thì 0 byte đi qua VPS, còn đây thì tốn cả tải xuống lẫn
 * đẩy lên.
 */

import fs from "node:fs";
import path from "node:path";

import { createLogger } from "../shared/logger.js";
import { chayYtDlp } from "./chay-yt-dlp.js";

const log = createLogger("tai-yt-dlp");

/**
 * Trần thời gian cho một lượt TẢI. Rộng hơn hẳn lượt đọc metadata (45 giây) vì
 * đây là tải thật: 100 MB trên đường truyền chậm mất vài phút.
 *
 * Vẫn phải có trần - quá hạn thì `execFile` GIẾT tiến trình. Để nó chạy mãi là
 * giữ luôn một trong hai suất song song.
 */
const TRAN_TAI_MS = 5 * 60_000;

/**
 * Cùng bộ chọn format với `nguon-yt-dlp.ts`: theo CODEC chứ không theo mã format.
 *
 * TUYỆT ĐỐI tránh format tên `download` - chính yt-dlp đánh dấu nó "Untested,
 * watermarked". Bộ chọn này không bao giờ trúng nó vì nó chỉ khớp theo codec.
 */
const CHON_FORMAT = "b[vcodec^=avc][ext=mp4]/b[ext=mp4]/b";

export type KetQuaTaiYtDlp =
  | { ok: true; duongDan: string; soByte: number }
  | { ok: false; loi: string; loiCauHinh?: boolean };

/**
 * Tải video của `url` vào `thuMuc` (phải là thư mục TRỐNG của ta).
 *
 * KHÔNG ném - mọi nhánh hỏng trả `{ok:false}`.
 *
 * `tranByte` đi vào `--max-filesize`, NHƯNG cờ đó chỉ chặn được khi NGUỒN CÓ
 * KHAI `Content-Length`. Đo cả hai chiều với cùng trần 1 MB và một máy chủ đẩy
 * 40 MB:
 *
 *   nguồn CÓ khai cỡ    -> yt-dlp dừng TRƯỚC khi tải, 0 byte xuống đĩa
 *   nguồn KHÔNG khai cỡ -> 41.944.076 byte NẰM TRÊN ĐĨA rồi mới bị từ chối
 *
 * (Cũng vô hiệu với tải theo mảnh HLS/DASH vì mỗi mảnh đều nhỏ.) Vì vậy phép
 * kiểm `soByte > tranByte` phía dưới KHÔNG phải thắt lưng thừa - nó là thứ duy
 * nhất chặn được file quá cỡ, và nó chỉ chặn việc GỬI chứ không ngăn được việc
 * đã ghi ra đĩa. `withEmptyTempDir` dọn ngay sau đó nên không rò rỉ, nhưng đừng
 * đọc chú thích này thành "trần luôn chặn từ đầu".
 */
export async function taiVideoBangYtDlp(
  url: string,
  thuMuc: string,
  tranByte: number,
  chay: typeof chayYtDlp = chayYtDlp,
): Promise<KetQuaTaiYtDlp> {
  const ket = await chay(
    [
      "--no-warnings",
      "--no-playlist",
      // Không để lại tệp `.part` dở dang, và `after_move:filepath` in ra đúng
      // đường dẫn cuối cùng - đoán tên file theo `%(ext)s` là đoán sai khi
      // yt-dlp chọn container khác.
      "--no-part",
      "--max-filesize",
      String(tranByte),
      "-f",
      CHON_FORMAT,
      "-o",
      path.join(thuMuc, "v.%(ext)s"),
      "--print",
      "after_move:filepath",
      url,
    ],
    TRAN_TAI_MS,
  );

  if (!ket.ok) return { ok: false, loi: ket.loi, loiCauHinh: ket.loiCauHinh };

  const duongDan = ket.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (duongDan === "") {
    // Vượt `--max-filesize` đi đường này: yt-dlp thoát mã 0 và KHÔNG in
    // `after_move:filepath` (nó bỏ cuộc trước khi có file để mà move).
    return { ok: false, loi: "yt-dlp không tạo được file (có thể video vượt giới hạn dung lượng)" };
  }

  // Xác nhận file NẰM TRONG thư mục của ta trước khi đụng vào. Phần `%(ext)s`
  // do yt-dlp suy từ format của extractor, tức dữ liệu chịu ảnh hưởng của bên
  // ngoài; kiểm một lần ở đây rẻ hơn nhiều so với tin rằng nó luôn lành.
  const tuyetDoi = path.resolve(duongDan);
  if (path.dirname(tuyetDoi) !== path.resolve(thuMuc)) {
    return { ok: false, loi: "yt-dlp ghi file ra ngoài thư mục tạm - từ chối dùng" };
  }

  let soByte: number;
  try {
    soByte = fs.statSync(tuyetDoi).size;
  } catch {
    return { ok: false, loi: "yt-dlp báo đã tải xong nhưng không thấy file" };
  }

  if (soByte === 0) return { ok: false, loi: "yt-dlp tạo ra file rỗng" };
  if (soByte > tranByte) {
    // Tới được đây nghĩa là `--max-filesize` KHÔNG chặn được (nguồn không khai
    // cỡ, hoặc khai sai), tức file đã nằm trên đĩa rồi mới bị từ chối. Ghi log
    // vì đó là thông tin về tài nguyên: im lặng thì người vận hành không bao
    // giờ biết đường này đang ngốn đĩa và băng thông.
    log.warn(
      { soByte, tranByte },
      "yt-dlp tải xong mới biết vượt trần - nguồn không khai đúng dung lượng",
    );
    return { ok: false, loi: "Video vượt giới hạn dung lượng" };
  }

  return { ok: true, duongDan: tuyetDoi, soByte };
}
