/**
 * Nguồn yt-dlp: DỰ PHÒNG cho TikTok, DUY NHẤT cho Facebook.
 *
 * Chỉ chạy `--dump-single-json --skip-download` - lấy metadata, KHÔNG tải video.
 * Đo thật: 3,94 giây, 72,8 MB RAM đỉnh, 1,44 giây CPU. RAM gần như không đổi
 * khi tải thật (75,6 MB) vì yt-dlp ghi thẳng ra đĩa - tức ~73 MB là bản thân
 * Python, và chi phí đó CỐ ĐỊNH mỗi tiến trình chứ không theo cỡ video. Đó là
 * lý do trần song song đặt ở 2.
 *
 * VÌ SAO KHÔNG DÙNG THƯ VIỆN JS: yt-dlp là tiến trình con, chạy xong thoát hẳn
 * và trả lại RAM. Không có server nào phải nuôi, không có cổng nào phải mở.
 *
 * CẬP NHẬT: `pip install -U yt-dlp` là đủ, KHÔNG phải sửa code. Đọc Changelog
 * chính thức 2025-2026: mọi breaking change đều về phiên bản Python/Node tối
 * thiểu, cú pháp `--exec`, aria2c, `--netrc-cmd` - KHÔNG cái nào đụng schema
 * JSON của `--dump-single-json`. Các trường dùng ở đây là phần lõi kế thừa từ
 * youtube-dl, ổn định nhiều năm.
 */

import { chayYtDlp } from "./chay-yt-dlp.js";
import { CO_MAC_DINH, CO_MAC_DINH_NGANG, type KetQuaNguon } from "./thong-tin-video.js";
import type { NenTangVideo } from "./whitelist-nguon-video.js";

/**
 * Trần thời gian. Đo 3,94 giây; đặt 45 giây vì Facebook có lúc phải qua vài
 * chặng chuyển hướng. Vượt là GIẾT tiến trình - để nó treo thì nó giữ luôn một
 * trong hai suất song song.
 */
const TRAN_MS = 45_000;

/**
 * CHỌN FORMAT THEO CODEC, KHÔNG THEO MÃ FORMAT.
 *
 * TikTok mặc định trả `bytevc1_*` là **h265**, mà h265 không phát được trên
 * nhiều máy cũ. Có bản h264 nhưng mã của nó (`h264_540p_1071120`) là con số
 * sinh theo bitrate - nó đổi giữa các video và biến mất bất cứ lúc nào. Chọn
 * theo thuộc tính `vcodec^=avc` thì không phụ thuộc mã.
 *
 * TUYỆT ĐỐI TRÁNH format tên `download`: chính yt-dlp đánh dấu nó
 * "Untested, watermarked". Bộ chọn này không bao giờ trúng nó vì nó chỉ khớp
 * theo codec, còn `download` thì yt-dlp xếp hạng thấp.
 *
 * KHÔNG CÓ nhánh ghép hình+tiếng (`bv*+ba`) - bản trước có, và đó là lỗi:
 * ghép cần ffmpeg, mà image CỐ Ý không cài ffmpeg (chạy ffmpeg trên nội dung
 * của người lạ là đúng thứ thiết kế này tránh). Để nhánh đó lại thì yt-dlp chọn
 * xong mới chết vì thiếu ffmpeg, và lỗi hạ tầng đó rơi vào câu chung "video có
 * thể ở chế độ riêng tư" - dắt người vận hành đi sai hướng. Chỉ nhận luồng đã
 * có sẵn cả hình lẫn tiếng.
 */
const CHON_FORMAT = "b[vcodec^=avc][ext=mp4]/b[ext=mp4]/b";

type InfoDict = Record<string, unknown>;

function so(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}
function chu(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Câu cho ca NỘI DUNG ĐÒI ĐĂNG NHẬP (Facebook Stories, bài trong nhóm kín).
 *
 * ĐO THẬT trên story của người dùng - phép đối chứng cùng công cụ, cùng điều kiện:
 *
 *   share/v/  -> generic -> chuyển hướng tới /reel/... -> facebook:reel -> TẢI ĐƯỢC
 *   /stories/ -> generic -> chuyển hướng tới login.php -> hết đường
 *
 * Chính máy chủ Facebook trả `302 -> login.php?next=<url gốc>`. Người dùng mở
 * được vì TRÌNH DUYỆT của họ gửi kèm cookie phiên - quyền xem nằm ở cookie,
 * không nằm trong URL. Máy chủ bot không có phiên Facebook nào.
 *
 * Chặn thứ hai, độc lập: rà cả 1751 extractor của yt-dlp thì URL
 * `/stories/<id>/<mã>/` KHÔNG khớp cái nào, phải rơi xuống `generic`.
 * (`story.php`/`story_fbid` trong pattern Facebook là BÀI ĐĂNG kiểu cũ, không
 * phải Stories 24 giờ - tên giống nhau, hai thứ khác hẳn.)
 *
 * Nên đây KHÔNG phải lỗi có thể sửa được ở phía mình. Thứ sửa được là nói đúng
 * bệnh: bản cũ trả câu "có thể video ở chế độ riêng tư, đã bị xóa" làm người
 * dùng đi thử lại vô ích.
 */
const LOI_CAN_DANG_NHAP =
  "Nội dung này Facebook bắt đăng nhập mới xem được (story, hoặc bài trong nhóm kín) nên bot không " +
  "tải được - bot không có tài khoản Facebook. Nói rõ với người dùng là loại link này không tải " +
  "được, và gợi ý họ gửi link bài đăng hoặc reel công khai thay thế. Đừng bảo họ thử lại.";

/** Cạnh dài sau khi chuẩn hóa - xem `chuanHoaTheoTiLe` */
const CANH_DAI_CHUAN = 1280;

/**
 * Giữ nguyên TỈ LỆ, đưa cạnh dài về `CANH_DAI_CHUAN`.
 *
 * Dùng khi chỉ biết tỉ lệ mà không biết độ phân giải thật của luồng sắp gửi.
 * Số chẵn hóa vì kích thước lẻ là thứ bộ giải mã video không thích.
 */
function chuanHoaTheoTiLe(co: { width: number; height: number }): { width: number; height: number } {
  const dai = Math.max(co.width, co.height);
  if (dai <= CANH_DAI_CHUAN) return co;
  const ty = CANH_DAI_CHUAN / dai;
  const chan = (n: number) => Math.max(2, Math.round((n * ty) / 2) * 2);
  return { width: chan(co.width), height: chan(co.height) };
}

/**
 * Khung hình THẬT của video. Đây là chỗ đã làm crash ứng dụng Zalo trên điện thoại.
 *
 * CA HỎNG ĐÃ XẢY RA THẬT (video Facebook 1280x720 ngang): yt-dlp chọn format
 * `hd`, mà format đó KHÔNG mang `width`/`height` - cả ở cấp trên lẫn trong chính
 * nó đều `null`. Bản cũ đọc không thấy nên lùi thẳng về mặc định DỌC 576x1024.
 * Zalo được bảo "video dọc" rồi nhận khung ngang: máy tính co giãn được nên xem
 * tạm được, còn ứng dụng điện thoại dựng sẵn bề mặt phát theo con số đã khai
 * rồi CRASH. Người dùng thấy một thẻ đen, khung dọc.
 *
 * Kích thước thật CÓ trong JSON, chỉ là nằm ở mảng `formats` (các luồng DASH
 * đều ghi 1280x720) - bản cũ đơn giản là không đọc tới đó. Đã xác nhận bằng
 * ffprobe trên chính luồng được gửi đi: 1280x720, h264.
 *
 * Thứ tự: cấp trên (TikTok có, đo được 1080x1920) -> format lớn nhất trong
 * `formats` -> mặc định THEO NỀN TẢNG. Đoán khung hình là việc nguy hiểm, nên
 * chỉ đoán khi thật sự không còn gì để đọc.
 */
function khungHinh(d: InfoDict, nenTang: NenTangVideo): { width: number; height: number } {
  const w = so(d.width);
  const h = so(d.height);
  if (w !== null && h !== null) return { width: w, height: h };

  // Mọi format của cùng một video có cùng TỈ LỆ nhưng khác ĐỘ PHÂN GIẢI, và
  // format được gửi đi (`hd` của Facebook) lại là cái KHÔNG khai kích thước.
  // Nên chỉ lấy được TỈ LỆ, không lấy được độ phân giải thật.
  //
  // ĐO THẬT trên video của người dùng: mảng formats có tới 2560x1440, trong khi
  // ffprobe trên đúng luồng được gửi cho 1280x720. Khai 2560x1440 thì tỉ lệ vẫn
  // đúng (16:9) nên không méo hình, nhưng vẫn là khai sai - mà chính việc khai
  // sai kích thước là thứ vừa làm crash ứng dụng Zalo trên điện thoại.
  //
  // Giữ TỈ LỆ, chuẩn hóa cạnh dài về 1280: thứ Zalo cần để dựng khung là tỉ lệ,
  // còn con số thì thà nói một mức phổ thông đúng tỉ lệ hơn là nói một mức cụ
  // thể mà ta không có cách nào biết. Với video này ra đúng 1280x720.
  const fs = Array.isArray(d.formats) ? (d.formats as InfoDict[]) : [];
  let tot: { width: number; height: number } | null = null;
  for (const f of fs) {
    const fw = so(f?.width);
    const fh = so(f?.height);
    if (fw === null || fh === null) continue;
    if (tot === null || fw * fh > tot.width * tot.height) tot = { width: fw, height: fh };
  }
  if (tot !== null) return chuanHoaTheoTiLe(tot);

  // Không còn gì để đọc. Mặc định theo NỀN TẢNG chứ không dùng một hằng số
  // chung: TikTok gần như luôn dọc, Facebook thì đa số ngang (và `sendVideo`
  // của zca-js cũng mặc định 1280x720 khi không truyền).
  return nenTang === "tiktok" ? { ...CO_MAC_DINH } : { ...CO_MAC_DINH_NGANG };
}

/** Cắt tên tác giả về độ dài lành mạnh - xem chú thích chỗ gọi */
function catTen(v: string | null): string | null {
  return v === null ? null : v.slice(0, 64);
}

/**
 * Phân loại lỗi của yt-dlp thành kết quả có kiểu. Hàm THUẦN, test được.
 *
 * Ba loại rất khác nhau, và nói nhầm loại thì người dùng làm sai việc:
 *
 *   - CẦN ĐĂNG NHẬP (story, nhóm kín): không bao giờ tải được. Bảo "thử lại
 *     sau" là để họ thử vô ích. Nhận ra bằng chính chuỗi lỗi của yt-dlp, vốn
 *     chứa URL cuối cùng nó bị dẫn tới (`login.php?next=...`).
 *   - THIẾU CÔNG CỤ: bệnh ở máy chủ, người vận hành phải sửa.
 *   - Còn lại: về video hoặc về nguồn. Chỉ nhóm này mới có ca đáng thử lại.
 */
export function phanLoaiLoiYtDlp(loi: string, loiCauHinh: boolean): KetQuaNguon {
  if (/login\.php|checkpoint\/|\/login\/\?next=/i.test(loi)) {
    return { ok: false, loi: LOI_CAN_DANG_NHAP, thuLaiDuoc: false, canDangNhap: true };
  }
  if (loiCauHinh) return { ok: false, loi, thuLaiDuoc: false, loiCauHinh: true };

  // "Unable to extract" / "Unexpected response" là TikTok trả trang thử thách -
  // ca chập chờn, thử lại có nghĩa (đo: 4 lần thử -> 5/6 phiên thành công).
  // "Video unavailable" / "Private" thì thử mãi cũng vậy.
  //
  // Timeout của tiến trình ra câu "đã dừng" chứ KHÔNG phải "timed out":
  // `execFile` giết tiến trình thì `err.message` chỉ ghi "Command failed",
  // không có chữ nào để mà bắt bằng regex (đã đo).
  const chapChon = /unable to extract|unexpected response|challenge|đã dừng|HTTP Error 5/i.test(loi);
  return { ok: false, loi, thuLaiDuoc: chapChon };
}

export async function layVideoTuYtDlp(url: string, nenTang: NenTangVideo): Promise<KetQuaNguon> {
  // Cờ siết bảo mật (`--ignore-config`, `--no-plugin-dirs`) nằm trong `chayYtDlp`
  // để mọi đường chạy yt-dlp cùng nhận - xem khối chú thích ở `chay-yt-dlp.ts`.
  const ket = await chayYtDlp(
    ["--dump-single-json", "--skip-download", "--no-warnings", "--no-playlist", "-f", CHON_FORMAT, url],
    TRAN_MS,
  );

  if (!ket.ok) return phanLoaiLoiYtDlp(ket.loi, ket.loiCauHinh === true);

  return docStdoutYtDlp(ket.stdout, nenTang);
}

/**
 * Đọc JSON của yt-dlp thành `KetQuaNguon`. Hàm THUẦN, không chạm tiến trình con.
 *
 * Tách khỏi `layVideoTuYtDlp` để test được: mọi lỗi ĐỌC SAI ÂM THẦM đều nằm ở
 * đây (giây thành mili giây, ảnh bìa thiếu, Facebook không trả khung hình), mà
 * kiểm chúng qua hàm kia thì buộc phải chạy yt-dlp thật - tức phải có mạng, có
 * binary, và video thật còn sống. Test như vậy đỏ vì lý do chẳng liên quan.
 */
export function docStdoutYtDlp(stdout: string, nenTang: NenTangVideo): KetQuaNguon {
  let d: InfoDict;
  try {
    d = JSON.parse(stdout) as InfoDict;
  } catch {
    return { ok: false, loi: "yt-dlp trả JSON không đọc được", thuLaiDuoc: true };
  }

  const videoUrl = chu(d.url);
  if (!videoUrl) {
    // Không có `url` phẳng nghĩa là format được chọn phải ghép tiếng + hình -
    // ca đó buộc phải tải và remux, mà remux là đúng thứ ta tránh (ffmpeg parse
    // nội dung của người lạ). Trả hỏng để chuỗi rơi sang nguồn khác.
    return {
      ok: false,
      loi: "Video này không có luồng phát sẵn (phải ghép hình và tiếng)",
      thuLaiDuoc: false,
    };
  }

  const giay = so(d.duration);

  // `thumbnail` thiếu thì lấy ảnh cuối trong `thumbnails` (yt-dlp xếp từ nhỏ
  // tới lớn). ĐO THẬT: Facebook không trả CẢ HAI - `thumbnail: null` và
  // `thumbnails: null`. Nên đường này chỉ đỡ được nền tảng khác; Facebook vẫn
  // ra chuỗi rỗng, và tầng tool ghi log cảnh báo cho ca đó.
  const dsAnh = Array.isArray(d.thumbnails) ? (d.thumbnails as InfoDict[]) : [];
  const anhCuoi = dsAnh.length > 0 ? chu(dsAnh[dsAnh.length - 1]?.url) : null;

  return {
    ok: true,
    video: {
      videoUrl,
      thumbnailUrl: chu(d.thumbnail) ?? anhCuoi ?? "",
      durationMs: giay === null ? 0 : Math.round(giay * 1000),
      ...khungHinh(d, nenTang),
      fileSize: so(d.filesize) ?? so(d.filesize_approx),
      // Cắt ngay tại nguồn: đây là chuỗi tự do của người đăng, và đo được nguồn
      // khai tên 200.000 ký tự thì bản cũ nuốt đủ 200.000 - đốt token, phình
      // log, phình DB. 64 ký tự thừa sức cho một tên tài khoản thật.
      tacGia: catTen(chu(d.uploader_id) ?? chu(d.uploader) ?? chu(d.channel)),
      nguon: "yt-dlp",
      nenTang,
    },
  };
}
