import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { kiemGioiHanVideo, type GioiHanVideo } from "./kiem-gioi-han-video.js";
import type { ThongTinVideo } from "./thong-tin-video.js";

const GH: GioiHanVideo = { thoiLuongToiDa: 30, dungLuongToiDa: 100 };

function video(sua: Partial<ThongTinVideo> = {}): ThongTinVideo {
  return {
    videoUrl: "https://cdn/x.mp4",
    thumbnailUrl: "https://cdn/x.jpg",
    durationMs: 24_000,
    width: 576,
    height: 1024,
    fileSize: 3_000_000,
    tacGia: "ai_do",
    nguon: "tikwm",
    nenTang: "tiktok",
    ...sua,
  };
}

describe("trần thời lượng", () => {
  it("video ngắn thì qua", () => {
    assert.equal(kiemGioiHanVideo(video({ durationMs: 24_000 }), GH).ok, true);
  });

  it("đúng bằng trần thì QUA - trần là 'tối đa', không phải 'nhỏ hơn'", () => {
    assert.equal(kiemGioiHanVideo(video({ durationMs: 30 * 60_000 }), GH).ok, true);
  });

  it("vượt trần dù chỉ 1ms thì chặn", () => {
    assert.equal(kiemGioiHanVideo(video({ durationMs: 30 * 60_000 + 1 }), GH).ok, false);
  });

  it("câu từ chối có ĐỦ SỐ để người dùng hiểu vì sao", () => {
    const k = kiemGioiHanVideo(video({ durationMs: 45 * 60_000 }), GH);
    assert.equal(k.ok, false);
    if (!k.ok) {
      assert.match(k.loi, /45 phút/, "phải nói video dài bao nhiêu");
      assert.match(k.loi, /30 phút/, "phải nói mức cho phép là bao nhiêu");
      assert.match(k.loi, /Cấu hình/, "phải chỉ được chỗ chỉnh mức đó");
    }
  });

  it("dưới 1 phút thì nói bằng GIÂY - '0,3 phút' đọc không ra", () => {
    const k = kiemGioiHanVideo(video({ durationMs: 20_000 }), { ...GH, thoiLuongToiDa: 0.2 });
    assert.equal(k.ok, false);
    if (!k.ok) assert.match(k.loi, /20 giây/);
  });

  it("nguồn KHÔNG nói thời lượng (0) thì CHO QUA, không chặn oan", () => {
    // `durationMs = 0` nghĩa là thiếu dữ liệu, không phải video dài 0 giây.
    // Từ chối một video hợp lệ vì nguồn thiếu trường là kết cục tệ hơn.
    assert.equal(kiemGioiHanVideo(video({ durationMs: 0 }), GH).ok, true);
  });
});

describe("trần dung lượng", () => {
  it("nhẹ thì qua", () => {
    assert.equal(kiemGioiHanVideo(video({ fileSize: 3_000_000 }), GH).ok, true);
  });

  it("vượt trần thì chặn, và nói rõ nặng bao nhiêu", () => {
    const k = kiemGioiHanVideo(video({ fileSize: 150 * 1024 * 1024 }), GH);
    assert.equal(k.ok, false);
    if (!k.ok) {
      assert.match(k.loi, /150\.0 MB|150 MB/);
      assert.match(k.loi, /100 MB/);
    }
  });

  it("nguồn không nói dung lượng (null) thì CHO QUA", () => {
    // Facebook đo thật KHÔNG trả `filesize`. Chặn ở đây là chặn oan mọi video
    // Facebook - trần thời lượng vẫn còn làm lưới đỡ.
    assert.equal(kiemGioiHanVideo(video({ fileSize: null }), GH).ok, true);
  });

  it("dung lượng 0 cũng coi là không biết", () => {
    assert.equal(kiemGioiHanVideo(video({ fileSize: 0 }), GH).ok, true);
  });
});

describe("hai trần cùng lúc", () => {
  it("thời lượng chặn TRƯỚC dung lượng - báo đúng lý do đầu tiên gặp", () => {
    // Video vừa dài vừa nặng thì nói cái nào cũng đúng, nhưng phải NHẤT QUÁN:
    // báo lung tung thì người dùng chỉnh sai chỗ.
    const k = kiemGioiHanVideo(
      video({ durationMs: 60 * 60_000, fileSize: 500 * 1024 * 1024 }),
      GH,
    );
    assert.equal(k.ok, false);
    if (!k.ok) assert.match(k.loi, /dài/);
  });

  it("thiếu CẢ HAI trường thì vẫn cho qua", () => {
    assert.equal(kiemGioiHanVideo(video({ durationMs: 0, fileSize: null }), GH).ok, true);
  });
});
