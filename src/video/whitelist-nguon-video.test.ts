import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { kiemNguonVideo, timUrlTrongChu } from "./whitelist-nguon-video.js";

describe("kiemNguonVideo - nhận đúng nguồn hợp lệ", () => {
  const HOP_LE: [string, "tiktok" | "facebook" | "instagram"][] = [
    ["https://www.tiktok.com/@ai/video/123", "tiktok"],
    ["https://vt.tiktok.com/ZSV5bEotV/", "tiktok"],
    ["https://vm.tiktok.com/ABC/", "tiktok"],
    ["https://tiktok.com/@ai/video/123", "tiktok"],
    ["https://www.facebook.com/watch/?v=123", "facebook"],
    ["https://fb.watch/abcdef/", "facebook"],
    ["https://m.facebook.com/reel/123", "facebook"],
    ["https://web.facebook.com/reel/123", "facebook"],
    // Instagram: reel/post/share, cả www lẫn m. Link app ra kèm ?igsh=...
    ["https://www.instagram.com/reel/CigMSGeD4Hd/", "instagram"],
    ["https://www.instagram.com/reel/CigMSGeD4Hd/?igsh=abc123", "instagram"],
    ["https://instagram.com/p/ABC123/", "instagram"],
    ["https://www.instagram.com/share/reel/xyz/", "instagram"],
    ["https://m.instagram.com/reel/abc/", "instagram"],
  ];
  for (const [url, nenTang] of HOP_LE) {
    it(`nhận ${url}`, () => {
      const k = kiemNguonVideo(url);
      assert.equal(k.ok, true, `phải nhận: ${JSON.stringify(k)}`);
      if (k.ok) assert.equal(k.nenTang, nenTang);
    });
  }
});

describe("kiemNguonVideo - CHẶN đường tấn công", () => {
  // Đây là lớp chống SSRF. Bot đọc tin của NGƯỜI LẠ, nên mỗi ca dưới đây là
  // một tin nhắn ai đó có thể soạn để bắt VPS gửi request hộ.
  const PHAI_CHAN: [string, string][] = [
    ["http://127.0.0.1:3900/api/tuning", "chính dashboard của bot"],
    ["http://localhost:6379", "Redis trên cùng máy"],
    ["http://169.254.169.254/latest/meta-data/", "endpoint metadata đám mây"],
    ["http://[::1]:8080/", "loopback IPv6"],
    ["file:///etc/passwd", "đọc file trên máy"],
    ["file:///C:/Windows/win.ini", "đọc file trên Windows"],
    ["ftp://tiktok.com/x", "scheme lạ dù host đúng"],
    ["https://tiktok.com.ke-tan-cong.net/x", "tên miền giả dạng bằng tiền tố"],
    ["https://faketiktok.com/x", "tên miền chứa chữ tiktok"],
    ["https://instagram.com.ke-tan-cong.net/reel/x", "instagram giả dạng bằng tiền tố"],
    ["https://fakeinstagram.com/reel/x", "tên miền chứa chữ instagram"],
    ["https://www.threads.com/@a/post/x", "Threads - yt-dlp không hỗ trợ, phải chặn"],
    ["https://ke-tan-cong.net/?next=https://tiktok.com/", "host thật nằm ở query"],
    ["https://youtube.com/watch?v=1", "nền tảng ngoài phạm vi"],
    ["https://evil.com/tiktok.com/video", "tên miền đúng nằm ở đường dẫn"],
  ];
  for (const [url, viSao] of PHAI_CHAN) {
    it(`chặn ${url} (${viSao})`, () => {
      const k = kiemNguonVideo(url);
      assert.equal(k.ok, false, `PHẢI CHẶN nhưng lại nhận: ${url}`);
    });
  }

  it("chuỗi rỗng và rác đều bị chặn", () => {
    for (const x of ["", "   ", "không phải url", "javascript:alert(1)"]) {
      assert.equal(kiemNguonVideo(x).ok, false, `phải chặn: ${JSON.stringify(x)}`);
    }
  });

  it("CHẶN userinfo - host thật nằm sau dấu @", () => {
    // `tiktok.com` ở đây là USERNAME, host thật là 127.0.0.1.
    const k = kiemNguonVideo("http://tiktok.com:pass@127.0.0.1/x");
    assert.equal(k.ok, false, "PHẢI CHẶN: host thật là 127.0.0.1");
  });

  it("chặn cả khi userinfo trỏ tới host HỢP LỆ - luật là chặn userinfo, không xét đích", () => {
    assert.equal(kiemNguonVideo("http://ai:do@www.tiktok.com/@a/video/1").ok, false);
  });

  it("host viết HOA vẫn nhận ra - đừng để đổi chữ hoa là lách được", () => {
    assert.equal(kiemNguonVideo("https://WWW.TIKTOK.COM/@a/video/1").ok, true);
  });

  it("dấu chấm thừa cuối host vẫn nhận ra - `tiktok.com.` là cùng một host", () => {
    assert.equal(kiemNguonVideo("https://www.tiktok.com./@a/video/1").ok, true);
  });
});

describe("URL trả về phải ĐÃ CHUẨN HÓA - đây là lỗ hổng đã chứng minh chạy được", () => {
  // Lỗi thật: hàm này kiểm host bằng `new URL()` của Node, còn yt-dlp phân tích
  // lại bằng `urllib` của Python. Hai bộ không đồng ý về dấu `\`. Trả chuỗi THÔ
  // thì whitelist gác một địa chỉ mà yt-dlp đi một địa chỉ khác.
  //
  // Đã dựng máy chủ ở 127.0.0.1:8791 và chạy yt-dlp thật - máy chủ nội bộ NHẬN
  // ĐƯỢC request. Không phải suy luận.
  const BS = String.fromCharCode(92);

  it("dấu \\ trong host: Node đọc ra tiktok.com nhưng Python đọc ra 127.0.0.1", () => {
    const doc = `http://tiktok.com${BS}@127.0.0.1:8791/api/tuning`;
    const k = kiemNguonVideo(doc);

    // Node CHO QUA ca này - đó chính là vấn đề, và vì thế `url` trả về phải là
    // bản đã chuẩn hóa chứ không phải chuỗi vào.
    assert.equal(k.ok, true, "Node coi đây là tiktok.com - ca này vốn lọt whitelist");
    if (k.ok) {
      assert.ok(
        !k.url.includes(BS),
        `url trả về CÒN dấu \\ - Python sẽ đọc ra 127.0.0.1: ${k.url}`,
      );
      assert.notEqual(k.url, doc, "trả nguyên chuỗi vào là mở lại lỗ hổng");
      assert.equal(k.url, "http://tiktok.com/@127.0.0.1:8791/api/tuning");
    }
  });

  it("url hợp lệ bình thường vẫn trả về dùng được, không bị bóp méo", () => {
    const k = kiemNguonVideo("https://vt.tiktok.com/ZSV5bEotV/");
    assert.equal(k.ok, true);
    if (k.ok) assert.equal(k.url, "https://vt.tiktok.com/ZSV5bEotV/");
  });

  it("mọi ca hợp lệ đều trả url PHÂN TÍCH LẠI ra đúng host ban đầu", () => {
    // Chốt tổng: dù chuẩn hóa thế nào, host của url trả về phải vẫn nằm trong
    // danh sách trắng. Không thì chuẩn hóa lại thành một đường vòng mới.
    for (const u of [
      "https://www.tiktok.com/@ai/video/123",
      "https://vt.tiktok.com/ABC/",
      "https://www.facebook.com/watch/?v=1",
      "https://fb.watch/abc/",
    ]) {
      const k = kiemNguonVideo(u);
      assert.equal(k.ok, true, u);
      if (k.ok) assert.equal(kiemNguonVideo(k.url).ok, true, `url trả về không tự qua lại được: ${k.url}`);
    }
  });
});

describe("timUrlTrongChu", () => {
  it("bóc được url nằm giữa câu", () => {
    assert.equal(
      timUrlTrongChu("tải hộ cái này https://vt.tiktok.com/ZSV5bEotV/ nhé bạn"),
      "https://vt.tiktok.com/ZSV5bEotV/",
    );
  });

  it("bỏ dấu câu dính đuôi", () => {
    // Người ta hay viết "... link https://a.b/c." - dấu chấm không thuộc URL.
    assert.equal(timUrlTrongChu("xem link https://vt.tiktok.com/ABC."), "https://vt.tiktok.com/ABC");
    assert.equal(timUrlTrongChu("(https://fb.watch/xyz/)"), "https://fb.watch/xyz/");
  });

  it("không có url thì trả null, không trả chuỗi rỗng", () => {
    // Chuỗi rỗng sẽ lọt vào `kiemNguonVideo` rồi báo lỗi khác hẳn lý do thật.
    assert.equal(timUrlTrongChu("chào bạn"), null);
  });

  it("lấy url ĐẦU TIÊN khi có nhiều", () => {
    assert.equal(
      timUrlTrongChu("https://vt.tiktok.com/A và https://fb.watch/B"),
      "https://vt.tiktok.com/A",
    );
  });
});

describe("chặn đường dẫn chuyển tiếp", () => {
  /**
   * Bản vá ĐẦU TIÊN của lỗ này cấm theo TÊN MIỀN (`l.facebook.com`), và nó SAI
   * CÁCH: năng lực chuyển hướng `/l.php?u=` và `/flx/warn/?u=` chạy y hệt trên
   * `www.facebook.com`, `m.facebook.com`, `mbasic.facebook.com` - những tên
   * BẮT BUỘC phải cho qua vì video thật nằm ở đó.
   *
   * ĐÃ ĐO bằng máy chủ nghe thật ở `127.0.0.1:8791`: cả 5 biến thể dưới đây đều
   * lọt whitelist VÀ khiến yt-dlp gửi request thật vào địa chỉ nội bộ.
   */
  for (const [url, vi] of [
    ["https://www.facebook.com/l.php?u=http%3A%2F%2F169.254.169.254%2F", "www - tên miền phải cho qua"],
    ["https://facebook.com/l.php?u=http%3A%2F%2F127.0.0.1%3A3900%2F", "không có www"],
    ["https://m.facebook.com/l.php?u=http%3A%2F%2F127.0.0.1%3A3900%2F", "bản mobile"],
    ["https://mbasic.facebook.com/l.php?u=http%3A%2F%2F127.0.0.1%3A3900%2F", "bản mbasic"],
    ["https://free.facebook.com/l.php?u=http%3A%2F%2F127.0.0.1%3A3900%2F", "bản free"],
    ["https://www.facebook.com/flx/warn/?u=http%3A%2F%2F127.0.0.1%3A3900%2F", "endpoint cảnh báo"],
    ["https://www.tiktok.com/redirect?target=http%3A%2F%2F127.0.0.1%2F", "tham số tên khác, nền tảng khác"],
    ["https://www.facebook.com/watch?v=1&next=http%3A%2F%2F127.0.0.1%2F", "nhét thêm vào link trông như thật"],
  ] as const) {
    it(`chặn ${vi}`, () => {
      assert.equal(kiemNguonVideo(url).ok, false, `phải chặn: ${url}`);
    });
  }

  it("chặn dạng lược scheme `//host` - không có `http:` vẫn là địa chỉ", () => {
    const u = `https://www.facebook.com/l.php?u=${encodeURIComponent("//127.0.0.1:3900/x")}`;
    assert.equal(kiemNguonVideo(u).ok, false);
  });

  it("chặn dạng MÃ HÓA HAI LỚP - cách né hiển nhiên nhất khi biết có bộ lọc", () => {
    // %2568ttp -> %68ttp -> http
    const u = "https://www.facebook.com/l.php?u=%2568ttp%3A%2F%2F127.0.0.1%3A3900%2Fx";
    assert.equal(kiemNguonVideo(u).ok, false);
  });

  it("host CHỈ ĐỂ CHUYỂN HƯỚNG bị cấm kể cả khi query KHÔNG mang URL", () => {
    // Ca này là HỒI QUY do chính phép kiểm siêu tập bắt được: luật hình dạng
    // không thấy gì ở `u=x` (không phải URL), nên nếu bỏ luật tên miền đi thì
    // payload này CHO LỌT trong khi bản trước đó chặn.
    for (const u of ["https://l.facebook.com/l.php?u=x", "https://L.FaceBook.CoM/l.php?u=x", "https://lm.facebook.com/?a=1"]) {
      assert.equal(kiemNguonVideo(u).ok, false, `phải chặn: ${u}`);
    }
  });

  it("l.instagram.com bị chặn kể cả khi query KHÔNG mang URL - nó KHỚP đuôi instagram.com", () => {
    // Từ khi thêm instagram.com vào whitelist, `l.instagram.com` khớp đuôi
    // `.instagram.com`. Nó CHỈ còn bị chặn vì luật chuyển-hướng chạy trước. Bỏ
    // `l.instagram.com` khỏi HOST_CHI_DE_CHUYEN_HUONG là mở SSRF: `?u=x` không
    // phải URL nên `mangUrlKhacTrongQuery` không thấy gì. Ca này khóa điều đó.
    for (const u of [
      "https://l.instagram.com/?u=x",
      "https://L.InstaGram.CoM/?u=x",
      "https://l.instagram.com/?u=http%3A%2F%2F127.0.0.1%3A3900%2F",
    ]) {
      assert.equal(kiemNguonVideo(u).ok, false, `phải chặn: ${u}`);
    }
  });

  it("KHÔNG chặn oan link thật - kể cả khi kèm tham số theo dõi", () => {
    // Link video thật không bao giờ nhét một URL khác vào query. `fbclid`,
    // `mibextid`, `is_from_webapp` là chuỗi định danh, không phải địa chỉ.
    for (const u of [
      "https://www.facebook.com/watch/?v=123",
      "https://www.facebook.com/reel/123",
      "https://www.facebook.com/share/v/abcdef/",
      "https://www.facebook.com/trang/videos/123?fbclid=IwAR123&mibextid=abc",
      "https://m.facebook.com/watch/?v=123&_rdr",
      "https://fb.watch/abc/",
      "https://www.tiktok.com/@ai/video/766?is_from_webapp=1&sender_device=pc",
      "https://vt.tiktok.com/ZSV5bEotV/",
      "https://www.tiktok.com/t/ZSabc/",
    ]) {
      assert.equal(kiemNguonVideo(u).ok, true, `phải cho qua: ${u}`);
    }
  });
});
