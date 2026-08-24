import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { docKhungHinhMp4, docThongTinMp4 } from "./doc-khung-hinh-mp4.js";

/**
 * Bộ đọc khung hình từ file MP4.
 *
 * Đây là thứ chữa ca CRASH THẬT: video Facebook 1280x720 ngang bị khai thành
 * 576x1024 dọc, ứng dụng Zalo trên điện thoại dựng sẵn bề mặt phát theo con số
 * đó rồi chết. Không nguồn nào khai đúng được: TikWM không trả kích thước gì
 * cả, yt-dlp thì format được chọn không mang, còn mảng `formats` khai lệch gấp
 * đôi so với luồng thật.
 *
 * Offset trong `tkhd` là ĐO THẬT trên file rồi đối chiếu ffprobe, không tính
 * nhẩm - bản đầu tôi lệch 4 byte và đọc ra chiều cao 16384 (phần tử cuối của ma
 * trận biến đổi).
 */

/** Dựng hộp `tkhd` với version, khung hình và ma trận cho trước */
function tkhd(
  width: number,
  height: number,
  tuyChon: { ver?: 0 | 1; maTran?: [number, number] } = {},
): Buffer {
  const ver = tuyChon.ver ?? 0;
  const dich = ver === 1 ? 12 : 0;
  const co = 92 + dich;
  const b = Buffer.alloc(co);
  b.writeUInt32BE(co, 0);
  b.write("tkhd", 4, "latin1");
  const than = 8;
  b[than] = ver;
  const [a, bb] = tuyChon.maTran ?? [0x00010000, 0];
  b.writeInt32BE(a, than + 40 + dich);
  b.writeInt32BE(bb, than + 44 + dich);
  b.writeUInt32BE(Math.round(width * 65536), than + 76 + dich);
  b.writeUInt32BE(Math.round(height * 65536), than + 80 + dich);
  return b;
}

/** Dựng hộp `mvhd` với timescale + duration cho trước (v0 hoặc v1) */
function mvhd(timescale: number, duration: number, ver: 0 | 1 = 0): Buffer {
  // v0 thân: version(1)+flags(3)+ctime(4)+mtime(4)+timescale(4)+duration(4) = 20
  // v1 thân: version(1)+flags(3)+ctime(8)+mtime(8)+timescale(4)+duration(8) = 32
  const than = ver === 1 ? 32 : 20;
  const b = Buffer.alloc(8 + than);
  b.writeUInt32BE(8 + than, 0);
  b.write("mvhd", 4, "latin1");
  b[8] = ver;
  if (ver === 1) {
    b.writeUInt32BE(timescale, 8 + 20);
    b.writeBigUInt64BE(BigInt(duration), 8 + 24);
  } else {
    b.writeUInt32BE(timescale, 8 + 12);
    b.writeUInt32BE(duration, 8 + 16);
  }
  return b;
}

/** Bọc các hộp con vào một hộp cha có tên cho trước */
function hop(ten: string, ...con: Buffer[]): Buffer {
  const than = Buffer.concat(con);
  const dau = Buffer.alloc(8);
  dau.writeUInt32BE(8 + than.length, 0);
  dau.write(ten, 4, "latin1");
  return Buffer.concat([dau, than]);
}

const FTYP = hop("ftyp", Buffer.from("isomiso2", "latin1"));

describe("đọc khung hình từ MP4", () => {
  it("đọc đúng video NGANG", () => {
    const b = Buffer.concat([FTYP, hop("moov", hop("trak", tkhd(1002, 576)))]);
    assert.deepEqual(docKhungHinhMp4(b), { width: 1002, height: 576 });
  });

  it("đọc đúng video DỌC", () => {
    const b = Buffer.concat([FTYP, hop("moov", hop("trak", tkhd(576, 1024)))]);
    assert.deepEqual(docKhungHinhMp4(b), { width: 576, height: 1024 });
  });

  it("BỎ QUA track âm thanh (khai 0x0) rồi đi tiếp tới track hình", () => {
    // Ca thật: `tkhd` ĐẦU TIÊN trong file TikTok là track âm thanh. Bản đầu của
    // tôi đọc nhầm đúng track đó và trả về kích thước vô nghĩa.
    const b = Buffer.concat([
      FTYP,
      hop("moov", hop("trak", tkhd(0, 0)), hop("trak", tkhd(1280, 720))),
    ]);
    assert.deepEqual(docKhungHinhMp4(b), { width: 1280, height: 720 });
  });

  it("hiểu tkhd version 1 (mốc thời gian 8 byte)", () => {
    const b = Buffer.concat([FTYP, hop("moov", hop("trak", tkhd(1920, 1080, { ver: 1 })))]);
    assert.deepEqual(docKhungHinhMp4(b), { width: 1920, height: 1080 });
  });

  it("ĐỔI CHIỀU khi ma trận báo xoay 90 độ", () => {
    // Video quay dọc bằng điện thoại hay lưu ngang kèm cờ xoay. Không xử lý là
    // lại khai sai chiều - đúng lớp lỗi vừa làm crash máy.
    const b = Buffer.concat([
      FTYP,
      hop("moov", hop("trak", tkhd(1280, 720, { maTran: [0, 0x00010000] }))),
    ]);
    assert.deepEqual(docKhungHinhMp4(b), { width: 720, height: 1280 });
  });

  it("đọc được cả khi `moov` dài hơn phần buffer đang có", () => {
    // Ta chỉ tải phần đầu file, mà `moov` thường lớn hơn thế. Bản đầu bỏ cuộc ở
    // đây và trả `null` cho mọi video thật.
    const day = Buffer.concat([FTYP, hop("moov", hop("trak", tkhd(800, 600)))]);
    day.writeUInt32BE(9_000_000, FTYP.length); // `moov` tự khai to hơn buffer
    assert.deepEqual(docKhungHinhMp4(day), { width: 800, height: 600 });
  });
});

describe("byte của người lạ thì không được làm hỏng lượt gửi", () => {
  it("không phải MP4 thì trả null, KHÔNG ném", () => {
    assert.equal(docKhungHinhMp4(Buffer.from("day khong phai video")), null);
  });

  it("buffer rỗng, hoặc quá ngắn", () => {
    assert.equal(docKhungHinhMp4(Buffer.alloc(0)), null);
    assert.equal(docKhungHinhMp4(Buffer.alloc(4)), null);
  });

  it("hộp khai cỡ 0 hoặc âm thì dừng, không lặp vô hạn", () => {
    const b = Buffer.alloc(64);
    b.writeUInt32BE(0, 0);
    b.write("moov", 4, "latin1");
    assert.equal(docKhungHinhMp4(b), null);

    const c = Buffer.alloc(64);
    c.writeUInt32BE(3, 0); // nhỏ hơn cả phần đầu hộp
    c.write("moov", 4, "latin1");
    assert.equal(docKhungHinhMp4(c), null);
  });

  it("hộp lồng nhau rất sâu thì dừng theo trần độ sâu", () => {
    let b = hop("trak", tkhd(100, 100));
    for (let i = 0; i < 20; i++) b = hop("moov", b);
    // Không khẳng định đọc được hay không - chỉ khẳng định nó TRẢ VỀ, không treo.
    const r = docKhungHinhMp4(Buffer.concat([FTYP, b]));
    assert.ok(r === null || (r.width > 0 && r.height > 0));
  });

  it("BỎ CUỘC khi phải lội qua quá nhiều hộp - đây là đánh đổi cố ý", () => {
    // File nhồi hàng nghìn hộp rỗng rồi mới tới `moov` là hình dạng không có
    // thật; trần số hộp chặn nó lại. Đổi lại: file hợp lệ mà đặt `moov` sau hơn
    // 300 hộp thì cũng bị bỏ - chấp nhận được vì file thật đặt `moov` ngay đầu.
    const rong: Buffer[] = [];
    for (let i = 0; i < 400; i++) rong.push(hop("free"));
    const b = Buffer.concat([FTYP, ...rong, hop("moov", hop("trak", tkhd(100, 100)))]);
    assert.equal(docKhungHinhMp4(b), null, "trần số hộp phải chặn, không đi tiếp mãi");
  });

  it("nhưng vài chục hộp rỗng thì vẫn đọc được bình thường", () => {
    const rong: Buffer[] = [];
    for (let i = 0; i < 50; i++) rong.push(hop("free"));
    const b = Buffer.concat([FTYP, ...rong, hop("moov", hop("trak", tkhd(100, 200)))]);
    assert.deepEqual(docKhungHinhMp4(b), { width: 100, height: 200 });
  });

  it("tkhd khai kích thước 0 ở mọi track thì trả null", () => {
    const b = Buffer.concat([FTYP, hop("moov", hop("trak", tkhd(0, 0)))]);
    assert.equal(docKhungHinhMp4(b), null);
  });
});

describe("đọc THỜI LƯỢNG từ mvhd - CÙNG lượt duyệt với khung hình", () => {
  it("v0: duration/timescale ra mili giây, VÀ lấy khung hình cùng một lượt", () => {
    // 3000/1000 = 3s = 3000ms. mvhd (con của moov) + tkhd (trong trak) cùng file.
    const b = Buffer.concat([FTYP, hop("moov", mvhd(1000, 3000), hop("trak", tkhd(720, 1280)))]);
    const r = docThongTinMp4(b);
    assert.equal(r.thoiLuongMs, 3000);
    assert.deepEqual(r.khung, { width: 720, height: 1280 }, "một lượt lấy cả hai");
  });

  it("v1 (mốc + duration 8 byte): đọc đúng", () => {
    const b = Buffer.concat([FTYP, hop("moov", mvhd(600, 90_000, 1))]); // 90000/600 = 150s
    assert.equal(docThongTinMp4(b).thoiLuongMs, 150_000);
  });

  it("khớp số đo trên file THẬT (offset mvhd) - reel IG 67,196ms", () => {
    // Offset đọc từ file IG thật rồi đối chiếu ffprobe (67.195692s -> 67196ms).
    const b = Buffer.concat([FTYP, hop("moov", mvhd(1000, 67_196))]);
    assert.equal(docThongTinMp4(b).thoiLuongMs, 67_196);
  });

  it("KHÔNG có mvhd -> thoiLuongMs null, vẫn đọc được khung (ca TikTok/FB cũ)", () => {
    const b = Buffer.concat([FTYP, hop("moov", hop("trak", tkhd(576, 1024)))]);
    const r = docThongTinMp4(b);
    assert.equal(r.thoiLuongMs, null);
    assert.deepEqual(r.khung, { width: 576, height: 1024 });
  });

  it("timescale = 0 -> null, KHÔNG chia cho 0", () => {
    const b = Buffer.concat([FTYP, hop("moov", mvhd(0, 3000))]);
    assert.equal(docThongTinMp4(b).thoiLuongMs, null);
  });

  it("duration sentinel 0xFFFFFFFF ('không biết') -> null, không ra số khổng lồ", () => {
    // 0xFFFFFFFF/1000 ~ 49,7 ngày, vượt trần -> null thay vì gửi Zalo một nhãn rác.
    const b = Buffer.concat([FTYP, hop("moov", mvhd(1000, 0xffffffff))]);
    assert.equal(docThongTinMp4(b).thoiLuongMs, null);
  });

  it("docKhungHinhMp4 vẫn trả CHỈ khung hình - chữ ký cũ nguyên vẹn", () => {
    const b = Buffer.concat([FTYP, hop("moov", mvhd(1000, 5000), hop("trak", tkhd(100, 200)))]);
    assert.deepEqual(docKhungHinhMp4(b), { width: 100, height: 200 });
  });
});
