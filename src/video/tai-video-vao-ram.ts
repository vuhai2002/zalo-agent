/**
 * Lấy byte video vào BỘ NHỚ, không bao giờ chạm đĩa.
 *
 * VÌ SAO PHẢI CÓ BYTE - đo bằng lượt gửi thật tới điện thoại người dùng:
 *
 *   videoUrl là URL của TikTok/Facebook -> máy tính xem được, ĐIỆN THOẠI KHÔNG
 *   videoUrl là URL của Zalo            -> điện thoại xem mượt
 *
 * Rà cả 140 API của zca-js: không có cách nào đưa Zalo một URL rồi Zalo tự tải
 * về tự host. Nên muốn xem được trên điện thoại thì byte buộc phải đi qua đây.
 *
 * VÌ SAO KHÔNG GHI ĐĨA: người dùng chốt là băng thông không lo, nhưng tải-xóa
 * liên tục thì bào SSD và để lại rác. `uploadAttachment` của zca-js nhận
 * `{ data: Buffer, filename, metadata }` chứ không bắt buộc đường dẫn file - đã
 * rà từng nhánh, kể cả chỗ tính checksum. Nên toàn bộ đường đi là
 * mạng -> RAM -> Zalo, không có file tạm nào để mà xóa.
 *
 * ĐỔI LẠI: RAM đỉnh bằng trần dung lượng nhân số lượt song song. Đó là lý do
 * trần dung lượng mặc định phải khiêm tốn.
 */

import { downloadFromPublicUrl } from "../shared/safe-remote-download.js";
import { chayYtDlp } from "./chay-yt-dlp.js";
import { argsChonFormat } from "./chon-format-video.js";

/**
 * Trần thời gian cho lượt yt-dlp tự tải. Rộng hơn lượt đọc metadata vì đây là
 * tải thật; vẫn phải có trần, quá hạn là tiến trình bị giết.
 */
const TRAN_TAI_MS = 5 * 60_000;

export type KetQuaTai =
  | { ok: true; byte: Buffer; duong: "url" | "yt-dlp" }
  | { ok: false; loi: string; loiCauHinh?: boolean };

/** Các chỗ chạm ra ngoài, thay được từ ngoài CHỈ để test */
export type PhuThuocTai = {
  taiUrl: typeof downloadFromPublicUrl;
  chay: typeof chayYtDlp;
};

const PHU_THUOC_THAT: PhuThuocTai = { taiUrl: downloadFromPublicUrl, chay: chayYtDlp };

/**
 * Tải thẳng từ URL của nguồn.
 *
 * Đi qua `downloadFromPublicUrl` nên thừa hưởng nguyên lớp gác của tool đọc
 * web: chặn IP nội bộ, chống DNS rebinding, kiểm lại TỪNG hop chuyển hướng,
 * và dừng ngay khi vượt trần thay vì tải hết rồi mới biết.
 */
export async function taiTuUrlVaoRam(
  url: string,
  tranByte: number,
  phuThuoc: PhuThuocTai = PHU_THUOC_THAT,
): Promise<KetQuaTai> {
  try {
    const { data } = await phuThuoc.taiUrl(url, { maxBytes: tranByte });
    if (data.length === 0) return { ok: false, loi: "Tải về rỗng" };
    return { ok: true, byte: data, duong: "url" };
  } catch (err) {
    return { ok: false, loi: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Đối số cho lượt yt-dlp TỰ TẢI, nhận qua stdout. Tách THUẦN để test được: mấy
 * cờ này quyết định có ghi ra đĩa hay không (`-o -`) và chọn format nào
 * (`argsChonFormat`, chung với đường metadata), mà cả hai đều hỏng CÂM nếu viết sai.
 *
 * `-o -` xuất thẳng ra stdout nên không có file tạm nào - đã kiểm: 4.549.777
 * byte, header `ftyp` đúng mp4.
 */
export function doiSoTaiYtDlp(urlGoc: string, tranByte: number): string[] {
  return [
    "--no-warnings",
    "--no-playlist",
    // Chặn TRƯỚC khi tải khi nguồn có khai dung lượng. Nguồn không khai thì cờ
    // này vô hiệu - lưới đỡ thật là phép kiểm độ dài buffer trong hàm gọi nó.
    "--max-filesize",
    String(tranByte),
    ...argsChonFormat(),
    "-o",
    "-",
    urlGoc,
  ];
}

/**
 * Để yt-dlp tự tải.
 *
 * Đường này cần khi URL của nguồn không tải được từ máy ta: đo thật, URL TikTok
 * mà yt-dlp trả về gắn với phiên của nó và trả **403 ngay trên chính máy vừa
 * chạy yt-dlp**. Tự tải URL đó thì trượt; để nó tự tải thì được.
 */
export async function taiBangYtDlpVaoRam(
  urlGoc: string,
  tranByte: number,
  phuThuoc: PhuThuocTai = PHU_THUOC_THAT,
): Promise<KetQuaTai> {
  const ket = await phuThuoc.chay(
    doiSoTaiYtDlp(urlGoc, tranByte),
    TRAN_TAI_MS,
    // Trần buffer phải đủ chứa cả video, cộng chút biên cho phần yt-dlp in thêm.
    { nhiPhan: true, tranStdout: tranByte + 1024 * 1024 },
  );

  if (!ket.ok) return { ok: false, loi: ket.loi, loiCauHinh: ket.loiCauHinh };

  const byte = ket.stdoutNhiPhan ?? Buffer.alloc(0);
  if (byte.length === 0) {
    // Vượt `--max-filesize` đi đường này: yt-dlp thoát mã 0 nhưng không xuất gì.
    return { ok: false, loi: "yt-dlp không tải được nội dung nào (có thể video vượt giới hạn)" };
  }
  if (byte.length > tranByte) return { ok: false, loi: "Video vượt giới hạn dung lượng" };
  return { ok: true, byte, duong: "yt-dlp" };
}
