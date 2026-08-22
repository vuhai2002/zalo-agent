import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { CO_MAC_DINH } from "./thong-tin-video.js";

/**
 * yt-dlp là nguồn DUY NHẤT của Facebook và tầng dự phòng của TikTok.
 *
 * `docStdoutYtDlp` là hàm THUẦN - đây là nơi nằm của mọi lỗi ĐỌC SAI ÂM THẦM
 * (giây/mili giây, ảnh bìa, khung hình), nên test thẳng bằng JSON dựng sẵn.
 *
 * Ca THIẾU CÔNG CỤ có file riêng (`chay-yt-dlp.test.ts`) vì nó thuộc tầng chạy
 * tiến trình, dùng chung cho cả đường đọc metadata lẫn đường tải file.
 *
 * PHẢI `setupTestEnv()` trước rồi mới `await import()`: `chay-yt-dlp.ts` đọc
 * `src/config/env.ts`, mà module đó `process.exit(1)` khi env không hợp lệ - đủ
 * để giết cả test runner.
 */

let dataDir: string;
let mod: typeof import("./nguon-yt-dlp.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./nguon-yt-dlp.js");
});

after(() => cleanupTestEnv(dataDir));

/** Hình dạng thật của info dict, rút gọn còn các trường code đọc tới */
const JSON_DU = JSON.stringify({
  url: "https://cdn.test/video.mp4",
  thumbnail: "https://cdn.test/thumb.jpg",
  duration: 32.6,
  width: 576,
  height: 1024,
  filesize: 2_000_000,
  uploader_id: "nguoidung123",
  title: "Video thử",
});

describe("yt-dlp - đọc JSON", () => {
  it("đổi GIÂY sang MILI GIÂY, làm tròn", () => {
    const ket = mod.docStdoutYtDlp(JSON_DU, "tiktok");
    assert.ok(ket.ok);
    assert.equal(ket.video.durationMs, 32_600);
  });

  it("JSON hỏng thì báo lỗi THỬ LẠI ĐƯỢC chứ không ném", () => {
    const ket = mod.docStdoutYtDlp("{khong phai json", "tiktok");
    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && ket.thuLaiDuoc);
  });

  it("thiếu `url` phẳng là hỏng HẲN - ca đó buộc phải ghép hình và tiếng", () => {
    // Ghép hình+tiếng nghĩa là phải chạy ffmpeg trên nội dung của người lạ -
    // đúng thứ thiết kế này tránh. Rơi sang nguồn khác chứ không tự ghép.
    const ket = mod.docStdoutYtDlp(JSON.stringify({ duration: 10, width: 1, height: 1 }), "tiktok");
    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && !ket.thuLaiDuoc, "thử lại không làm video mọc ra luồng phát sẵn");
  });

  it("thiếu `thumbnail` thì lấy ảnh CUỐI trong `thumbnails` (yt-dlp xếp nhỏ tới lớn)", () => {
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({
        url: "https://cdn.test/v.mp4",
        thumbnails: [{ url: "https://cdn.test/nho.jpg" }, { url: "https://cdn.test/to.jpg" }],
      }),
      "tiktok",
    );
    assert.ok(ket.ok);
    assert.equal(ket.video.thumbnailUrl, "https://cdn.test/to.jpg");
  });

  it("Facebook không trả ảnh bìa nào - vẫn phải ra kết quả OK với chuỗi rỗng", () => {
    // ĐO THẬT: Facebook trả `thumbnail: null` VÀ `thumbnails: null`. Ném cả lượt
    // đi vì thiếu ảnh bìa là mất luôn nguồn duy nhất của Facebook.
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({ url: "https://cdn.test/v.mp4", thumbnail: null, thumbnails: null }),
      "facebook",
    );
    assert.ok(ket.ok);
    assert.equal(ket.video.thumbnailUrl, "");
  });

  it("KHUNG HÌNH: đọc từ `formats` khi cấp trên không có - ca đã làm crash máy", () => {
    /**
     * CA THẬT: video Facebook 1280x720 NGANG. yt-dlp chọn format `hd`, mà format
     * đó không mang width/height ở đâu cả. Bản cũ lùi thẳng về mặc định DỌC
     * 576x1024, Zalo dựng khung dọc cho khung ngang -> thẻ đen, và ứng dụng trên
     * điện thoại CRASH khi mở hội thoại.
     *
     * Kích thước thật CÓ trong `formats` - bản cũ chỉ là không đọc tới đó.
     */
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({
        url: "https://cdn.test/v.mp4",
        width: null,
        height: null,
        formats: [
          { format_id: "sd", width: null, height: null },
          { format_id: "hd", width: null, height: null },
          // Tỉ lệ 2.4:1 (điện ảnh) - CỐ Ý khác hẳn 16:9 của mặc định nền tảng.
          // Dùng 16:9 ở đây thì ca này xanh cả khi code bỏ qua `formats` và rơi
          // về mặc định, tức xanh vì lý do sai - phép phá đã bắt đúng như vậy.
          { format_id: "dash", width: 1920, height: 800 },
        ],
      }),
      "facebook",
    );
    assert.ok(ket.ok);
    assert.ok(ket.video.width > ket.video.height, "khai DỌC cho video NGANG là ca đã làm crash máy");
    // Sai số nhỏ là do chẵn hóa cạnh khi chuẩn hóa (533,3 -> 534), không phải
    // do đọc sai. Khẳng định theo SAI SỐ, và ngưỡng đủ chặt để loại mặc định
    // 16:9 (1,78) - thứ mà một phép phá đã chứng minh là lọt nếu dùng 16:9 ở đây.
    const tyLe = ket.video.width / ket.video.height;
    assert.ok(
      Math.abs(tyLe - 1920 / 800) < 0.01,
      `phải lấy tỉ lệ THẬT từ formats (2,4), không phải mặc định nền tảng (1,78). Nhận: ${tyLe}`,
    );
  });

  it("KHUNG HÌNH: giữ tỉ lệ, chuẩn hóa cạnh dài về 1280", () => {
    // Đo thật: mảng formats có tới 2560x1440 trong khi ffprobe trên đúng luồng
    // được gửi cho 1280x720. Chỉ biết được TỈ LỆ, không biết độ phân giải thật.
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({ url: "https://cdn.test/v.mp4", formats: [{ width: 2560, height: 1440 }] }),
      "facebook",
    );
    assert.ok(ket.ok);
    assert.deepEqual({ w: ket.video.width, h: ket.video.height }, { w: 1280, h: 720 });
  });

  it("KHUNG HÌNH: cấp trên có thì tin cấp trên, KHÔNG chuẩn hóa", () => {
    // TikTok qua yt-dlp đo được 1080x1920 ở cấp trên - đó là số của chính luồng
    // sắp gửi nên chính xác hơn mọi suy đoán từ `formats`.
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({
        url: "https://cdn.test/v.mp4",
        width: 1080,
        height: 1920,
        formats: [{ width: 2560, height: 1440 }],
      }),
      "tiktok",
    );
    assert.ok(ket.ok);
    assert.deepEqual({ w: ket.video.width, h: ket.video.height }, { w: 1080, h: 1920 });
  });

  it("KHUNG HÌNH: không biết gì thì mặc định theo NỀN TẢNG", () => {
    const fb = mod.docStdoutYtDlp(JSON.stringify({ url: "https://cdn.test/v.mp4" }), "facebook");
    const tt = mod.docStdoutYtDlp(JSON.stringify({ url: "https://cdn.test/v.mp4" }), "tiktok");
    assert.ok(fb.ok && tt.ok);
    assert.ok(fb.video.width > fb.video.height, "Facebook đa số NGANG");
    assert.ok(tt.video.height > tt.video.width, "TikTok gần như luôn DỌC");
    assert.equal(tt.video.width, CO_MAC_DINH.width);
  });

  it("mang theo đúng nền tảng được truyền vào", () => {
    const fb = mod.docStdoutYtDlp(JSON_DU, "facebook");
    const tt = mod.docStdoutYtDlp(JSON_DU, "tiktok");
    assert.ok(fb.ok && tt.ok);
    assert.equal(fb.video.nenTang, "facebook");
    assert.equal(tt.video.nenTang, "tiktok");
  });

  it("CẮT tên tác giả - nguồn khai 200.000 ký tự thì không nuốt đủ 200.000", () => {
    // `uploader` là TÊN HIỂN THỊ, chuỗi tự do do người đăng tự đặt. Không cắt
    // thì nó đốt token, phình log và phình DB.
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({ url: "https://cdn.test/v.mp4", uploader: "A".repeat(200_000) }),
      "tiktok",
    );
    assert.ok(ket.ok);
    assert.ok(ket.video.tacGia!.length <= 64, `dài ${ket.video.tacGia!.length} ký tự`);
  });

  it("KHÔNG chở tiêu đề video - trường đó đã bị bỏ hẳn", () => {
    // Tiêu đề cũng là chuỗi tự do của người đăng, và không ai đọc nó. Chở một
    // chuỗi của người lạ đi vòng quanh mà không ai dùng chỉ là chờ ngày có
    // người dùng nó nhầm chỗ.
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({ url: "https://cdn.test/v.mp4", title: "bất kỳ" }),
      "tiktok",
    );
    assert.ok(ket.ok);
    assert.ok(!("tieuDe" in ket.video), "trường tieuDe không được sống lại");
  });

  it("`filesize_approx` dùng khi không có `filesize`", () => {
    const ket = mod.docStdoutYtDlp(
      JSON.stringify({ url: "https://cdn.test/v.mp4", filesize_approx: 999 }),
      "tiktok",
    );
    assert.ok(ket.ok);
    assert.equal(ket.video.fileSize, 999);
  });
});

describe("phanLoaiLoiYtDlp - nói ĐÚNG loại bệnh", () => {
  /**
   * Ba loại rất khác nhau, nói nhầm loại thì người dùng làm sai việc:
   * cần đăng nhập (không bao giờ được), thiếu công cụ (người vận hành sửa),
   * lỗi về video/nguồn (có ca đáng thử lại).
   */
  it("Facebook đẩy sang login.php -> CẦN ĐĂNG NHẬP, không thử lại", () => {
    // Chuỗi dưới đây chép nguyên văn từ lần chạy thật với story của người dùng.
    // Hình dạng chép từ lần chạy thật, ID đã thay bằng số giả - ID story là dữ
    // liệu cá nhân của người dùng, không có việc gì nằm trong repo.
    const loi =
      "ERROR: Unsupported URL: https://www.facebook.com/login.php?next=https%3A%2F%2F" +
      "www.facebook.com%2Fstories%2F000000000000000%2FUzpf%3D%2F&_fb_noscript=1";
    const r = mod.phanLoaiLoiYtDlp(loi, false);

    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.canDangNhap === true, "thiếu cờ là bot bảo người dùng thử lại vô ích");
    assert.ok(!r.ok && !r.thuLaiDuoc);
    assert.ok(!r.ok && !/Unsupported URL|login\.php/.test(r.loi), "stderr thô KHÔNG được chảy vào câu model đọc");
  });

  it("bắt cả checkpoint và /login/?next=", () => {
    for (const loi of [
      "ERROR: https://www.facebook.com/checkpoint/?next=x",
      "ERROR: redirected to https://www.instagram.com/login/?next=/p/abc/",
    ]) {
      const r = mod.phanLoaiLoiYtDlp(loi, false);
      assert.ok(!r.ok && r.canDangNhap === true, loi);
    }
  });

  it("thiếu công cụ -> cờ loiCauHinh, KHÔNG phải canDangNhap", () => {
    const r = mod.phanLoaiLoiYtDlp("Máy chủ chưa cài yt-dlp...", true);
    assert.ok(!r.ok && r.loiCauHinh === true);
    assert.ok(!r.ok && !r.canDangNhap);
    assert.ok(!r.ok && !r.thuLaiDuoc, "thiếu binary thì thử lại vô ích");
  });

  it("trang thử thách của TikTok là ca ĐÁNG THỬ LẠI", () => {
    const r = mod.phanLoaiLoiYtDlp("ERROR: [TikTok] Unable to extract universal data", false);
    assert.ok(!r.ok && r.thuLaiDuoc, "đo được: 4 lần thử -> 5/6 phiên thành công");
    assert.ok(!r.ok && !r.canDangNhap);
  });

  it("video riêng tư / đã xóa thì KHÔNG thử lại", () => {
    for (const loi of ["ERROR: This video is private", "ERROR: Video unavailable"]) {
      const r = mod.phanLoaiLoiYtDlp(loi, false);
      assert.ok(!r.ok && !r.thuLaiDuoc, loi);
      assert.ok(!r.ok && !r.canDangNhap, "đừng nhận nhầm thành 'cần đăng nhập'");
    }
  });
});
