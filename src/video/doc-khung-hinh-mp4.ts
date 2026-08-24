/**
 * Đọc KHUNG HÌNH và THỜI LƯỢNG THẬT từ chính file MP4, thay vì tin metadata nguồn.
 *
 * VÌ SAO PHẢI CÓ (khung hình) - ca thật, người dùng gặp: video Facebook 1280x720
 * NGANG bị khai thành 576x1024 DỌC, và ứng dụng Zalo trên ĐIỆN THOẠI CRASH khi mở
 * hội thoại. Zalo dựng sẵn bề mặt phát theo con số ta khai rồi nhận khung khác hẳn.
 *
 * VÌ SAO CÓ THÊM THỜI LƯỢNG: Instagram (yt-dlp) trả `duration: null`, nên nếu chỉ
 * tin nguồn thì thẻ video hiện 0:00. Thời lượng nằm sẵn trong hộp `mvhd` của file
 * (2 trường `timescale` + `duration`), đọc thẳng từ đó là chính xác. Đọc CHUNG một
 * lượt duyệt cây hộp với khung hình - không tốn thêm gì (buffer đã ở RAM).
 *
 * Vì sao không tin nguồn (khung hình):
 *
 *   TikWM   KHÔNG trả width/height gì cả (đã dump toàn bộ khóa của phản hồi)
 *   yt-dlp  format `hd` của Facebook không mang width/height ở đâu, kể cả trong
 *           chính nó; còn mảng `formats` thì khai 2560x1440 trong khi luồng
 *           được gửi đi đo bằng ffprobe là 1280x720
 *
 * Đọc từ file thì không phụ thuộc nguồn nào khai gì. Đã kiểm trên video thật khớp
 * ffprobe từng số: TikTok ngang/dọc, Facebook ngang, Instagram 720x1280 + 67s.
 *
 * AN TOÀN: đây là bộ đọc byte của người lạ, nên nó cố ý rất hẹp - chỉ đi theo cây
 * hộp MP4 để tìm `tkhd`/`mvhd`, không giải mã một khung hình nào, không cấp phát
 * theo số file khai, có trần số hộp và trần độ sâu. Mọi phép đọc đều kiểm biên
 * trước. Hỏng thì trả `null` chứ không ném.
 */

/** Trần số hộp duyệt qua - chặn file cố tình nhồi hàng vạn hộp rỗng */
const TRAN_HOP = 300;

/** Độ sâu tối đa khi đi vào hộp lồng nhau (`moov` -> `trak` -> ...) */
const TRAN_SAU = 3;

/**
 * Vị trí các trường trong hộp `tkhd`, tính từ đầu THÂN hộp.
 *
 * ĐO THẬT trên file TikTok rồi đối chiếu ffprobe, không chép từ trí nhớ: bản
 * đầu tôi tính nhẩm sai 4 byte và đọc ra chiều cao 16384 (đó là phần tử cuối
 * của ma trận biến đổi, `0x40000000`).
 *
 * Version 1 dùng mốc thời gian 8 byte thay vì 4, ở ba trường, nên mọi thứ sau
 * đó dịch thêm 12 byte.
 */
const VI_TRI_MA_TRAN = 40;
const VI_TRI_KHUNG = 76;
const DICH_KHI_VERSION_1 = 12;

/** Hộp `tkhd` phải đủ dài tới hết chiều cao mới đọc được */
const CAN_TOI_THIEU = VI_TRI_KHUNG + 8;

/**
 * Vị trí `timescale` + `duration` trong hộp `mvhd`, tính từ đầu THÂN hộp.
 *
 * Thân `mvhd`: version(1) + flags(3), rồi
 *   version 0: creation(4) modification(4) timescale(4)@12 duration(4)@16
 *   version 1: creation(8) modification(8) timescale(4)@20 duration(8)@24
 */
const MVHD_V0_TIMESCALE = 12;
const MVHD_V0_DURATION = 16;
const MVHD_V1_TIMESCALE = 20;
const MVHD_V1_DURATION = 24;
const MVHD_CAN_V0 = MVHD_V0_DURATION + 4;
const MVHD_CAN_V1 = MVHD_V1_DURATION + 8;

/** Trần thời lượng hợp lý - bắt được ca `duration` khai sentinel "không biết" (0xFFFFFFFF) */
const THOI_LUONG_TRAN_MS = 24 * 60 * 60 * 1000;

export type KhungHinh = { width: number; height: number };
export type ThongTinMp4 = { khung: KhungHinh | null; thoiLuongMs: number | null };

/** timescale + duration -> mili giây, hoặc `null` nếu vô lý (kể cả sentinel "không biết") */
function tinhThoiLuongMs(timescale: number, duration: number): number | null {
  if (!(timescale > 0) || !(duration > 0) || !Number.isFinite(duration)) return null;
  const ms = Math.round((duration / timescale) * 1000);
  return Number.isFinite(ms) && ms > 0 && ms < THOI_LUONG_TRAN_MS ? ms : null;
}

/**
 * Đọc cả KHUNG HÌNH (từ `tkhd`) lẫn THỜI LƯỢNG (từ `mvhd`) trong MỘT lượt duyệt.
 *
 * Không trả sớm ở `tkhd` đầu tiên như bản cũ: đi tiếp tới khi có ĐỦ cả hai (hoặc
 * hết hộp / chạm trần). `mvhd` là con trực tiếp của `moov`, `tkhd` nằm trong
 * `trak` - cùng vùng nên gặp cả hai gần như ngay.
 */
export function docThongTinMp4(b: Buffer): ThongTinMp4 {
  let demHop = 0;
  let khung: KhungHinh | null = null;
  let thoiLuongMs: number | null = null;
  const xong = () => khung !== null && thoiLuongMs !== null;

  function docTkhd(than: number, het: number): KhungHinh | null {
    const ver = b[than];
    if (ver === undefined) return null;
    const dich = ver === 1 ? DICH_KHI_VERSION_1 : 0;
    if (than + CAN_TOI_THIEU + dich > het) return null;

    const mt = than + VI_TRI_MA_TRAN + dich;
    const ok = than + VI_TRI_KHUNG + dich;
    const w = b.readUInt32BE(ok) / 65536;
    const h = b.readUInt32BE(ok + 4) / 65536;
    if (!(w > 0 && h > 0)) return null; // track âm thanh khai 0x0

    // Ma trận biến đổi: `a === 0 && b !== 0` nghĩa là xoay 90 hoặc 270 độ, tức
    // khung HIỂN THỊ đảo chiều so với khung lưu. Video quay dọc bằng điện thoại
    // hay lưu ngang kèm cờ xoay - không xử lý là lại khai sai chiều, đúng lỗi
    // vừa làm crash máy.
    const a = b.readInt32BE(mt);
    const bb = b.readInt32BE(mt + 4);
    const xoay = a === 0 && bb !== 0;

    return xoay
      ? { width: Math.round(h), height: Math.round(w) }
      : { width: Math.round(w), height: Math.round(h) };
  }

  function docMvhd(than: number, het: number): number | null {
    const ver = b[than];
    if (ver === undefined) return null;
    if (ver === 1) {
      if (than + MVHD_CAN_V1 > het) return null;
      const ts = b.readUInt32BE(than + MVHD_V1_TIMESCALE);
      const dur = Number(b.readBigUInt64BE(than + MVHD_V1_DURATION));
      return tinhThoiLuongMs(ts, dur);
    }
    if (than + MVHD_CAN_V0 > het) return null;
    const ts = b.readUInt32BE(than + MVHD_V0_TIMESCALE);
    const dur = b.readUInt32BE(than + MVHD_V0_DURATION);
    return tinhThoiLuongMs(ts, dur);
  }

  function duyet(dau: number, cuoi: number, sau: number): void {
    let i = dau;
    while (i + 8 <= cuoi && !xong() && demHop++ < TRAN_HOP) {
      let co = b.readUInt32BE(i);
      const ten = b.toString("latin1", i + 4, i + 8);
      let than = i + 8;

      if (co === 1) {
        // Cỡ 64-bit nằm ngay sau tên hộp
        if (than + 8 > cuoi) return;
        co = Number(b.readBigUInt64BE(than));
        than += 8;
      }
      if (co === 0) co = cuoi - i; // hộp cuối, kéo tới hết
      if (co < 8 || !Number.isFinite(co)) return;

      // KHÔNG bỏ cuộc khi hộp dài hơn phần đang có: `moov` thường lớn hơn phần
      // đầu file ta tải về, mà `tkhd`/`mvhd` thì nằm ngay trong đoạn đầu của nó.
      const het = Math.min(i + co, cuoi);

      if (ten === "tkhd") {
        if (khung === null) {
          const r = docTkhd(than, het);
          if (r) khung = r;
        }
      } else if (ten === "mvhd") {
        if (thoiLuongMs === null) {
          const r = docMvhd(than, het);
          if (r !== null) thoiLuongMs = r;
        }
      } else if ((ten === "moov" || ten === "trak") && sau < TRAN_SAU) {
        duyet(than, het, sau + 1);
      }

      i += co;
    }
  }

  try {
    duyet(0, b.length, 0);
  } catch {
    // Byte của người lạ - đọc lệch biên thì bỏ, đừng làm hỏng cả lượt gửi.
  }
  return { khung, thoiLuongMs };
}

/**
 * Chỉ lấy khung hình. Giữ nguyên chữ ký cũ cho các chỗ chỉ cần kích thước.
 *
 * Tìm `tkhd` của track ĐẦU TIÊN có kích thước khác 0. Track âm thanh cũng có
 * `tkhd` nhưng khai 0x0 - đã đo, và bản đầu của tôi đọc nhầm đúng track đó.
 */
export function docKhungHinhMp4(b: Buffer): KhungHinh | null {
  return docThongTinMp4(b).khung;
}
