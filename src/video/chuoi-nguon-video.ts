/**
 * Chuỗi nguồn: thử nguồn chính, hỏng thì rơi sang nguồn dự phòng.
 *
 * THỨ TỰ và LÝ DO (số đo 2026-08-22, cùng IP cùng khung giờ):
 *
 *   TikTok:    TikWM (12/12, 1,0s) -> yt-dlp (3/7, 3,9s)
 *   Facebook:  yt-dlp (5/5)         -> hết, TikWM không nhận Facebook
 *
 * Hai nguồn của TikTok ĐỘC LẬP THẬT SỰ: một cái gọi API bên thứ ba, một cái tự
 * cào trang. TikWM sập thì yt-dlp vẫn chạy và ngược lại. Chuỗi dự phòng mà cả
 * hai tầng cùng dựa vào một cơ chế thì không phải dự phòng.
 *
 * Facebook chỉ có MỘT tầng - đó là giới hạn đã biết, không phải thiếu sót. Đo
 * được 5/5 nên chấp nhận được.
 */

import { layVideoTuTikwm } from "./nguon-tikwm.js";
import { layVideoTuYtDlp } from "./nguon-yt-dlp.js";
import type { KetQuaNguon, TenNguonVideo } from "./thong-tin-video.js";
import type { NenTangVideo } from "./whitelist-nguon-video.js";

/** Một mắt xích: tên để ghi log, và hàm gọi */
export type MatXich = { ten: TenNguonVideo; chay: (url: string) => Promise<KetQuaNguon> };

export function chuoiNguonCho(nenTang: NenTangVideo): MatXich[] {
  if (nenTang === "tiktok") {
    return [
      { ten: "tikwm", chay: (u) => layVideoTuTikwm(u) },
      { ten: "yt-dlp", chay: (u) => layVideoTuYtDlp(u, "tiktok") },
    ];
  }
  return [{ ten: "yt-dlp", chay: (u) => layVideoTuYtDlp(u, "facebook") }];
}

export type TuyChonChuoi = {
  /** Số lần thử MỖI mắt xích. Đo: 4 lần -> 5/6 phiên thành công với yt-dlp */
  soLanThu: number;
  /**
   * Nghỉ giữa hai lần thử, mili giây.
   *
   * TikWM giới hạn **1 request/giây** (đo thật, họ báo thẳng trong lỗi:
   * `Free Api Limit: 1 request/second`). Nghỉ phải >= 1000ms, không thì lần thử
   * lại tự đâm vào giới hạn và ta tưởng nguồn hỏng.
   */
  nghiMs: number;
  /** Chỉ để test bơm đồng hồ giả vào - sản xuất dùng mặc định */
  doi?: (ms: number) => Promise<void>;
  /**
   * Chuỗi mắt xích. Bỏ trống thì lấy theo nền tảng.
   *
   * Tiêm được từ ngoài vì nếu không thì test luật rơi tầng buộc phải GỌI MẠNG
   * THẬT (TikWM) và CHẠY TIẾN TRÌNH CON THẬT (yt-dlp) - test như vậy vừa chậm
   * vừa chập chờn theo mạng, mà lại chẳng đo đúng thứ cần đo. Đường thay thế là
   * chép lại thuật toán vào test, nhưng bản chép thì không bao giờ đỏ khi bản
   * thật sai.
   */
  chuoi?: MatXich[];
};

const NGHI_MAC_DINH = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type KetQuaChuoi =
  | { ok: true; video: import("./thong-tin-video.js").ThongTinVideo }
  | {
      ok: false;
      /**
       * Chuỗi gộp lỗi của mọi mắt xích, CHỈ ĐỂ GHI LOG.
       *
       * Tên có hậu tố `ChoLog` là cố ý: nó ghép stderr của yt-dlp với thân lỗi
       * của TikWM, tức chữ do BÊN THỨ BA sinh ra. Chữ đó không được chảy vào
       * câu tool trả cho model - model hay chép nguyên văn cho người nhắn. Tool
       * đọc cờ `loiCauHinh` để chọn câu, không đọc chuỗi này.
       */
      loiChoLog: string;
      daThu: { nguon: TenNguonVideo; loi: string }[];
      /**
       * CÓ mắt xích nào hỏng vì máy chủ thiếu cấu hình không.
       *
       * Gộp bằng HOẶC chứ không lấy của mắt xích cuối: chuỗi TikTok là
       * TikWM -> yt-dlp, nên ca "TikWM sập + máy chưa cài yt-dlp" có mắt xích
       * cuối mang cờ, nhưng ca ngược lại cũng phải bắt được. Chỉ cần MỘT mắt
       * xích báo lỗi cấu hình là người vận hành có việc phải làm.
       */
      loiCauHinh: boolean;
      /** Có mắt xích nào báo nội dung đòi đăng nhập không - xem `KetQuaNguon.canDangNhap` */
      canDangNhap: boolean;
    };

/**
 * Chạy hết chuỗi cho tới khi có kết quả.
 *
 * Luật rơi tầng: lỗi `thuLaiDuoc: false` (URL sai, video riêng tư, video đã xóa)
 * thì BỎ QUA phần thử lại của mắt xích đó và sang mắt xích sau ngay - thử lại
 * một lỗi vĩnh viễn chỉ tốn thời gian của người đang đợi.
 */
export async function layVideoQuaChuoi(
  url: string,
  nenTang: NenTangVideo,
  tuyChon: TuyChonChuoi,
): Promise<KetQuaChuoi> {
  const doi = tuyChon.doi ?? NGHI_MAC_DINH;
  const daThu: { nguon: TenNguonVideo; loi: string }[] = [];

  let loiCauHinh = false;
  let canDangNhap = false;

  for (const mat of tuyChon.chuoi ?? chuoiNguonCho(nenTang)) {
    let loiCuoi = "không rõ";
    for (let lan = 1; lan <= Math.max(1, tuyChon.soLanThu); lan++) {
      const ket = await mat.chay(url);
      if (ket.ok) return { ok: true, video: ket.video };

      loiCuoi = ket.loi;
      if (ket.loiCauHinh) loiCauHinh = true;
      if (ket.canDangNhap) canDangNhap = true;
      if (!ket.thuLaiDuoc) break;
      // Không nghỉ sau lần thử CUỐI - nghỉ xong rồi bỏ đi là phí thời gian của
      // người đang đợi, và nó chiếm suất trong hàng đợi song song.
      if (lan < tuyChon.soLanThu) await doi(tuyChon.nghiMs);
    }
    daThu.push({ nguon: mat.ten, loi: loiCuoi });
  }

  return {
    ok: false,
    loiChoLog: daThu.map((t) => `${t.nguon}: ${t.loi}`).join(" | "),
    daThu,
    loiCauHinh,
    canDangNhap,
  };
}
