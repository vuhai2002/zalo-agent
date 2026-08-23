import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  doCoThat,
  kiemUrlVideoConSong,
  laKieuVideo,
  quyetDinhTuHeader,
} from "./kiem-url-video-truoc-khi-gui.js";

/**
 * Bộ dò là lớp thay thế cho giả định "URL hỏng thì sendVideo sẽ ném" - giả định
 * đó SAI và đã làm bot báo "đã gửi" cho video chết.
 *
 * Hai hàm thuần test thẳng. Phần chạm mạng chỉ test các nhánh CHẶN TRƯỚC KHI
 * MỞ KẾT NỐI, vì mọi địa chỉ nội bộ đều bị chính lớp bảo vệ chặn - không dựng
 * được máy chủ thật để thử phần còn lại.
 */

describe("doCoThat - lấy cỡ THẬT của cả file", () => {
  it("206 thì đọc đuôi content-range, KHÔNG đọc content-length", () => {
    // Đây là bẫy chính: với 206 thì `content-length` là độ dài PHẦN vừa xin
    // (1 byte), không phải cỡ file. Đọc nhầm là mọi video đều "1 byte" và trần
    // dung lượng thành vô nghĩa.
    assert.equal(doCoThat(206, "bytes 0-0/6667679", 1), 6_667_679);
  });

  it("206 với khoảng trắng thừa vẫn đọc được", () => {
    assert.equal(doCoThat(206, "bytes 0-0/1024  ", 1), 1024);
  });

  it("206 mà content-range hỏng hoặc thiếu thì trả null, KHÔNG lùi về content-length", () => {
    // Lùi về `content-length` ở đây là ghi nhận cỡ 1 byte - sai còn tệ hơn
    // không biết, vì trần dung lượng sẽ cho lọt mọi thứ.
    assert.equal(doCoThat(206, undefined, 1), null);
    assert.equal(doCoThat(206, "bytes */*", 1), null);
    assert.equal(doCoThat(206, "rac", 1), null);
  });

  it("200 thì content-length CHÍNH LÀ cỡ đầy đủ", () => {
    // Máy chủ bỏ qua `Range` thì trả nguyên file kèm cỡ thật.
    assert.equal(doCoThat(200, undefined, 5_000_000), 5_000_000);
  });

  it("không có gì đáng tin thì null - thà không biết còn hơn biết sai", () => {
    assert.equal(doCoThat(200, undefined, NaN), null);
    assert.equal(doCoThat(200, undefined, 0), null);
  });
});

describe("laKieuVideo", () => {
  it("nhận video/*", () => {
    for (const k of ["video/mp4", "video/webm", "VIDEO/MP4", "video/mp4; charset=binary", " video/mp4 "]) {
      assert.equal(laKieuVideo(k), true, k);
    }
  });

  it("nhận application/octet-stream - đó là 'không biết', không phải 'biết là HTML'", () => {
    assert.equal(laKieuVideo("application/octet-stream"), true);
  });

  it("TỪ CHỐI text/html - trang 'link hết hạn' hoặc trang chặn bot", () => {
    // Ca này không ném, `bytes > 0`, nên mọi lưới đỡ dựa vào ngoại lệ đều lọt.
    for (const k of ["text/html", "text/html; charset=utf-8", "text/plain", "application/json", ""]) {
      assert.equal(laKieuVideo(k), false, k);
    }
  });
});

describe("quyetDinhTuHeader - phần QUYẾT ĐỊNH của bộ dò", () => {
  /**
   * Đo được trước khi có nhóm ca này: bỏ cửa `laKieuVideo` hoặc cửa status thì
   * CẢ 2389 ca test vẫn xanh - vì mọi ca chạm mạng đều bị `openGuardedRequest`
   * chặn từ trước khi mở kết nối nên không ca nào đi tới phần quyết định.
   *
   * Tức `laKieuVideo` được chứng minh là đúng, nhưng "bộ dò CÓ gọi nó" thì
   * không ai chứng minh - mà chính cái sau mới là lỗi vòng rà soát đi sửa.
   */
  it("206 + video/mp4 là QUA, và đọc cỡ thật từ content-range", () => {
    const r = quyetDinhTuHeader(206, "video/mp4", "bytes 0-0/6667679", 1);
    assert.ok(r.ok);
    assert.equal(r.soByte, 6_667_679);
  });

  it("200 + video/mp4 là QUA", () => {
    assert.equal(quyetDinhTuHeader(200, "video/mp4", undefined, 5_000_000).ok, true);
  });

  it("403 là TRƯỢT - đây là ca đã trả giá, sendVideo KHÔNG ném với 403", () => {
    const r = quyetDinhTuHeader(403, "video/mp4", undefined, 0);
    assert.equal(r.ok, false);
    assert.match((r as { ly: string }).ly, /403/);
  });

  it("mọi status ngoài 2xx đều TRƯỢT", () => {
    for (const st of [0, 400, 404, 429, 500, 503]) {
      assert.equal(quyetDinhTuHeader(st, "video/mp4", undefined, 1).ok, false, `status ${st}`);
    }
  });

  it("200 + text/html là TRƯỢT - trang 'link hết hạn' không ném và bytes > 0", () => {
    // Ca này lọt qua MỌI lưới đỡ dựa vào ngoại lệ. Không chặn ở đây thì nội dung
    // HTML được ghi ra `<tên>.mp4` rồi gửi đi như video.
    const r = quyetDinhTuHeader(200, "text/html; charset=utf-8", undefined, 2048);
    assert.equal(r.ok, false);
    assert.match((r as { ly: string }).ly, /không phải video/i);
  });

  it("kiểu nội dung TRỐNG cũng TRƯỢT", () => {
    assert.equal(quyetDinhTuHeader(200, "", undefined, 100).ok, false);
  });

  it("application/octet-stream QUA - 'không biết' khác 'biết là HTML'", () => {
    assert.equal(quyetDinhTuHeader(200, "application/octet-stream", undefined, 100).ok, true);
  });
});

describe("quyetDinhTuHeader - mang theo URL đã xác thực", () => {
  it("trả về URL CUỐI để caller tải đúng chỗ đã kiểm", () => {
    // Caller tải bằng URL này chứ không bằng chuỗi gốc: bộ dò đã đi hết chuyển
    // hướng và kiểm địa chỉ ở TỪNG hop, nên đây là thứ duy nhất được xác thực.
    const r = quyetDinhTuHeader(206, "video/mp4", "bytes 0-0/100", 1, "https://cdn.test/cuoi.mp4");
    assert.ok(r.ok);
    assert.equal(r.urlCuoi, "https://cdn.test/cuoi.mp4");
  });
});

describe("kiemUrlVideoConSong - thừa hưởng lớp chặn địa chỉ nội bộ", () => {
  // `videoUrl` là chuỗi do TikWM/yt-dlp trả về. Không có bước này thì nó đi
  // thẳng vào `sendVideo`, mà zca-js đi theo `location` ĐỆ QUY, không đếm hop,
  // không kiểm địa chỉ.
  for (const [url, vi] of [
    ["http://127.0.0.1:3900/x.mp4", "dashboard của chính bot"],
    ["http://localhost:6379/x.mp4", "dịch vụ trên cùng máy"],
    ["http://169.254.169.254/latest/meta-data/", "metadata đám mây"],
    ["http://192.168.1.1/x.mp4", "mạng LAN"],
    ["http://[::1]:8080/x.mp4", "loopback IPv6"],
  ] as const) {
    it(`chặn ${vi}`, async () => {
      const r = await kiemUrlVideoConSong(url);
      assert.equal(r.ok, false);
      assert.match((r as { ly: string }).ly, /nội bộ/i, `phải nói rõ lý do: ${url}`);
    });
  }

  it("chỉ nhận http/https", async () => {
    const r = await kiemUrlVideoConSong("file:///C:/Windows/win.ini");
    assert.equal(r.ok, false);
    assert.match((r as { ly: string }).ly, /http/i);
  });

  it("URL rác trả lỗi rõ ràng, KHÔNG ném", async () => {
    const r = await kiemUrlVideoConSong("khong-phai-url");
    assert.equal(r.ok, false);
    assert.match((r as { ly: string }).ly, /không hợp lệ/i);
  });
});
