import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { layVideoTuTikwm } from "./nguon-tikwm.js";

/**
 * TikWM là nguồn CHÍNH của TikTok - mọi video TikTok người dùng gửi đi qua đây.
 *
 * Ca quan trọng nhất trong file này là `play` vs `wmplay`. Đó là quyết định
 * người dùng tự kiểm bằng MẮT trên hai file tải thật (`wmplay` có logo TikTok
 * di chuyển, `play` sạch), và lấy nhầm trường thì không có gì đỏ: bot vẫn gửi
 * được video, vẫn báo thành công, chỉ là video có watermark - đúng thứ tính
 * năng này sinh ra để tránh.
 *
 * Chặn `globalThis.fetch` thay vì gọi thật: gọi thật thì test đỏ khi mạng chậm,
 * khi TikWM chạm giới hạn 1 request/giây, hoặc khi video mẫu bị xóa.
 */

const fetchThat = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchThat;
});

/** Thay `fetch` bằng một câu trả lời dựng sẵn, ghi lại URL đã gọi */
function chanFetch(than: unknown, status = 200): { urlDaGoi: string[] } {
  const urlDaGoi: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    urlDaGoi.push(String(u));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => than,
    } as Response;
  }) as typeof fetch;
  return { urlDaGoi };
}

/** Thân trả về đủ trường, giống hệt hình dạng đo được từ TikWM thật */
const THAN_DU = {
  code: 0,
  data: {
    play: "https://tikwm.test/KHONG-watermark.mp4",
    wmplay: "https://tikwm.test/CO-watermark.mp4",
    cover: "https://tikwm.test/cover.jpg",
    origin_cover: "https://tikwm.test/origin.jpg",
    duration: 20,
    size: 1_234_567,
    title: "Video thử",
    author: { unique_id: "nguoidung123" },
  },
};

describe("TikWM - chọn đúng bản không watermark", () => {
  it("lấy `play` chứ KHÔNG lấy `wmplay`", async () => {
    chanFetch(THAN_DU);
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.ok(ket.ok);
    assert.equal(
      ket.video.videoUrl,
      "https://tikwm.test/KHONG-watermark.mp4",
      "`wmplay` có logo TikTok di chuyển - đã kiểm bằng mắt trên hai file tải thật",
    );
    assert.doesNotMatch(ket.video.videoUrl, /CO-watermark/);
  });

  it("thiếu `play` là HỎNG, KHÔNG được lặng lẽ rơi sang `wmplay`", async () => {
    // Ca này canh đúng đường sửa sai dễ nghĩ ra nhất: "play thiếu thì dùng tạm
    // wmplay cho có video". Có video watermark còn tệ hơn không có video, vì
    // người dùng không biết mình vừa nhận bản bẩn.
    chanFetch({ code: 0, data: { ...THAN_DU.data, play: undefined } });
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && !/CO-watermark/.test(ket.loi));
  });
});

describe("TikWM - quy đổi và mặc định", () => {
  it("đổi GIÂY sang MILI GIÂY - `sendVideo` nhận mili giây", async () => {
    chanFetch(THAN_DU);
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.ok(ket.ok);
    assert.equal(ket.video.durationMs, 20_000, "quên nhân 1000 thì video 20 giây báo là 20 mili giây");
  });

  it("thiếu thời lượng thì để 0 chứ không để NaN", async () => {
    chanFetch({ code: 0, data: { ...THAN_DU.data, duration: undefined } });
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.ok(ket.ok);
    assert.equal(ket.video.durationMs, 0);
  });

  it("thiếu `cover` thì lùi về `origin_cover`", async () => {
    chanFetch({ code: 0, data: { ...THAN_DU.data, cover: undefined } });
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.ok(ket.ok);
    assert.equal(ket.video.thumbnailUrl, "https://tikwm.test/origin.jpg");
  });

  it("thiếu cả hai ảnh bìa thì để chuỗi rỗng, KHÔNG ném cả lượt đi", async () => {
    chanFetch({ code: 0, data: { ...THAN_DU.data, cover: undefined, origin_cover: undefined } });
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.ok(ket.ok, "mất cái ảnh bìa mà bỏ luôn video là đánh đổi sai");
    assert.equal(ket.video.thumbnailUrl, "");
  });

  it("khung hình mặc định là DỌC - TikWM không trả width/height", async () => {
    chanFetch(THAN_DU);
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.ok(ket.ok);
    assert.ok(
      ket.video.height > ket.video.width,
      "mặc định NGANG là Zalo dựng khung sai cho mọi video TikTok",
    );
  });
});

describe("TikWM - phân loại lỗi để chuỗi biết có nên thử lại không", () => {
  it("chạm giới hạn tốc độ là THỬ LẠI ĐƯỢC", async () => {
    chanFetch({ code: -1, msg: "Free Api Limit: 1 request/second" });
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && ket.thuLaiDuoc, "nghỉ 1 giây rồi thử lại là qua - coi là hỏng hẳn thì mất video");
  });

  it("URL sai là hỏng HẲN, không thử lại", async () => {
    chanFetch({ code: -1, msg: "Url parsing is failed" });
    const ket = await layVideoTuTikwm("https://www.facebook.com/watch/?v=1");

    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && !ket.thuLaiDuoc, "thử lại một lỗi vĩnh viễn chỉ tốn thời gian người đang đợi");
  });

  it("HTTP 5xx là phía họ - thử lại được", async () => {
    chanFetch({}, 503);
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && ket.thuLaiDuoc);
  });

  it("HTTP 4xx là ta gửi sai - thử lại vô ích", async () => {
    chanFetch({}, 404);
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && !ket.thuLaiDuoc);
  });

  it("KHÔNG bao giờ báo `loiCauHinh` - TikWM không phải thứ cài trên máy chủ", async () => {
    chanFetch({}, 500);
    const ket = await layVideoTuTikwm("https://www.tiktok.com/@a/video/1");

    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && !ket.loiCauHinh, "báo nhầm là bảo người vận hành đi cài thứ không cần cài");
  });
});

describe("TikWM - dựng URL gọi", () => {
  it("mã hóa URL người dùng vào tham số truy vấn", async () => {
    const { urlDaGoi } = chanFetch(THAN_DU);
    await layVideoTuTikwm("https://vt.tiktok.com/ABC?a=1&b=2");

    assert.equal(urlDaGoi.length, 1);
    assert.ok(
      urlDaGoi[0]!.includes(encodeURIComponent("https://vt.tiktok.com/ABC?a=1&b=2")),
      "không mã hóa thì `&b=2` thành tham số của TikWM chứ không phải của URL",
    );
  });
});
