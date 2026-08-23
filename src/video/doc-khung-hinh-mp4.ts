/**
 * Đọc KHUNG HÌNH THẬT từ chính file MP4, thay vì tin metadata của nguồn.
 *
 * VÌ SAO PHẢI CÓ - ca thật, người dùng gặp: video Facebook 1280x720 NGANG bị
 * khai thành 576x1024 DỌC, và ứng dụng Zalo trên ĐIỆN THOẠI CRASH khi mở hội
 * thoại. Zalo dựng sẵn bề mặt phát theo con số ta khai rồi nhận khung khác hẳn.
 *
 * Vì sao không tin nguồn:
 *
 *   TikWM   KHÔNG trả width/height gì cả (đã dump toàn bộ khóa của phản hồi)
 *   yt-dlp  format `hd` của Facebook không mang width/height ở đâu, kể cả trong
 *           chính nó; còn mảng `formats` thì khai 2560x1440 trong khi luồng
 *           được gửi đi đo bằng ffprobe là 1280x720
 *
 * Đọc từ file thì không phụ thuộc nguồn nào khai gì. Đã kiểm trên ba video thật,
 * 3/3 khớp ffprobe từng số: TikTok ngang 1002x576, TikTok dọc 576x1024,
 * Facebook ngang 1280x720.
 *
 * AN TOÀN: đây là bộ đọc byte của người lạ, nên nó cố ý rất hẹp - chỉ đi theo
 * cây hộp MP4 để tìm `tkhd`, không giải mã một khung hình nào, không cấp phát
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

export type KhungHinh = { width: number; height: number };

/**
 * Tìm `tkhd` của track ĐẦU TIÊN có kích thước khác 0.
 *
 * Track âm thanh cũng có `tkhd` nhưng khai 0x0 - đã đo, và bản đầu của tôi đọc
 * nhầm đúng track đó. Bỏ qua track 0x0 rồi đi tiếp là ra track hình.
 */
export function docKhungHinhMp4(b: Buffer): KhungHinh | null {
  let demHop = 0;

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

  function duyet(dau: number, cuoi: number, sau: number): KhungHinh | null {
    let i = dau;
    while (i + 8 <= cuoi && demHop++ < TRAN_HOP) {
      let co = b.readUInt32BE(i);
      const ten = b.toString("latin1", i + 4, i + 8);
      let than = i + 8;

      if (co === 1) {
        // Cỡ 64-bit nằm ngay sau tên hộp
        if (than + 8 > cuoi) return null;
        co = Number(b.readBigUInt64BE(than));
        than += 8;
      }
      if (co === 0) co = cuoi - i; // hộp cuối, kéo tới hết
      // Hai phép kiểm này TRÙNG với `try/catch` ở dưới: bỏ chúng đi thì file
      // hỏng vẫn ra `null`, chỉ khác là qua đường ném. Phép phá xác nhận đúng
      // như vậy - không ca test nào đỏ. Giữ vì nó nói rõ ý định và bỏ sớm rẻ
      // hơn, nhưng đừng đọc chúng thành "đây là thứ chặn file độc".
      if (co < 8 || !Number.isFinite(co)) return null;

      // KHÔNG bỏ cuộc khi hộp dài hơn phần đang có: `moov` thường lớn hơn phần
      // đầu file ta tải về, mà `tkhd` thì nằm ngay trong đoạn đầu của nó.
      // Phép kẹp biên cũng trùng với `try/catch` (phép phá không làm ca nào đỏ);
      // giữ vì đọc quá biên rồi bắt ngoại lệ là cách làm việc bẩn hơn.
      const het = Math.min(i + co, cuoi);

      if (ten === "tkhd") {
        const r = docTkhd(than, het);
        if (r) return r;
      } else if ((ten === "moov" || ten === "trak") && sau < TRAN_SAU) {
        const r = duyet(than, het, sau + 1);
        if (r) return r;
      }

      i += co;
    }
    return null;
  }

  try {
    return duyet(0, b.length, 0);
  } catch {
    // Byte của người lạ - đọc lệch biên thì bỏ, đừng làm hỏng cả lượt gửi.
    return null;
  }
}
