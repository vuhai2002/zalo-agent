import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chuoiNguonCho, layVideoQuaChuoi, type MatXich } from "./chuoi-nguon-video.js";
import type { KetQuaNguon, TenNguonVideo, ThongTinVideo } from "./thong-tin-video.js";

function videoGia(nguon: TenNguonVideo): ThongTinVideo {
  return {
    videoUrl: "https://cdn/x.mp4",
    thumbnailUrl: "https://cdn/x.jpg",
    durationMs: 24_000,
    width: 576,
    height: 1024,
    fileSize: 1000,
    tacGia: "ai_do",
    nguon,
    nenTang: "tiktok",
  };
}

const HONG_THU_LAI: KetQuaNguon = { ok: false, loi: "chập chờn", thuLaiDuoc: true };
const HONG_VINH_VIEN: KetQuaNguon = { ok: false, loi: "video riêng tư", thuLaiDuoc: false };

/**
 * Dựng một mắt xích giả trả lần lượt các kết quả đã kê, kèm bộ đếm số lời gọi.
 *
 * Hết danh sách thì lặp lại phần tử cuối - để viết "luôn hỏng" chỉ cần kê một
 * phần tử thay vì kê đủ số lần thử.
 */
function matGia(ten: TenNguonVideo, ketQua: KetQuaNguon[]) {
  const dem = { soLan: 0 };
  const mat: MatXich = {
    ten,
    chay: async () => {
      const ket = ketQua[Math.min(dem.soLan, ketQua.length - 1)]!;
      dem.soLan++;
      return ket;
    },
  };
  return { mat, dem };
}

/** Không nghỉ thật - `sleep` thật làm test chậm mà chẳng đo thêm gì */
const KHONG_NGHI = async () => {};

describe("chuoiNguonCho - thứ tự nguồn", () => {
  it("TikTok: TikWM trước, yt-dlp sau", () => {
    // Thứ tự này là kết luận từ số đo (TikWM 12/12 so với yt-dlp 3/7). Đảo lại
    // là làm hỏng chính lý do chọn TikWM.
    assert.deepEqual(
      chuoiNguonCho("tiktok").map((m) => m.ten),
      ["tikwm", "yt-dlp"],
    );
  });

  it("Facebook: CHỈ yt-dlp - TikWM không nhận Facebook", () => {
    assert.deepEqual(
      chuoiNguonCho("facebook").map((m) => m.ten),
      ["yt-dlp"],
    );
  });
});

describe("layVideoQuaChuoi - luật rơi tầng", () => {
  it("nguồn đầu thành công -> KHÔNG chạm nguồn sau", async () => {
    const a = matGia("tikwm", [{ ok: true, video: videoGia("tikwm") }]);
    const b = matGia("yt-dlp", [HONG_THU_LAI]);

    const k = await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 4,
      nghiMs: 0,
      doi: KHONG_NGHI,
      chuoi: [a.mat, b.mat],
    });

    assert.equal(k.ok, true);
    if (k.ok) assert.equal(k.video.nguon, "tikwm");
    assert.equal(a.dem.soLan, 1);
    assert.equal(b.dem.soLan, 0, "không được gọi nguồn dự phòng khi nguồn chính chạy");
  });

  it("nguồn đầu chập chờn -> thử ĐỦ số lần rồi mới sang nguồn sau", async () => {
    const a = matGia("tikwm", [HONG_THU_LAI]);
    const b = matGia("yt-dlp", [{ ok: true, video: videoGia("yt-dlp") }]);

    const k = await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 4,
      nghiMs: 0,
      doi: KHONG_NGHI,
      chuoi: [a.mat, b.mat],
    });

    assert.equal(a.dem.soLan, 4, "phải thử đủ 4 lần trước khi bỏ nguồn chính");
    assert.equal(k.ok, true);
    if (k.ok) assert.equal(k.video.nguon, "yt-dlp");
  });

  it("lỗi VĨNH VIỄN -> bỏ qua phần thử lại, sang nguồn sau NGAY", async () => {
    // Thử lại một lỗi vĩnh viễn (url sai, video đã xóa) chỉ tốn thời gian của
    // người đang đợi VÀ giữ một trong hai suất song song.
    const a = matGia("tikwm", [HONG_VINH_VIEN]);
    const b = matGia("yt-dlp", [{ ok: true, video: videoGia("yt-dlp") }]);

    await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 4,
      nghiMs: 0,
      doi: KHONG_NGHI,
      chuoi: [a.mat, b.mat],
    });

    assert.equal(a.dem.soLan, 1, "lỗi vĩnh viễn chỉ được gọi ĐÚNG MỘT lần");
    assert.equal(b.dem.soLan, 1);
  });

  it("nguồn đầu hỏng 2 lần rồi chạy -> vẫn thắng, không cần nguồn sau", async () => {
    const a = matGia("tikwm", [HONG_THU_LAI, HONG_THU_LAI, { ok: true, video: videoGia("tikwm") }]);
    const b = matGia("yt-dlp", [HONG_THU_LAI]);

    const k = await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 4,
      nghiMs: 0,
      doi: KHONG_NGHI,
      chuoi: [a.mat, b.mat],
    });

    assert.equal(k.ok, true);
    assert.equal(a.dem.soLan, 3);
    assert.equal(b.dem.soLan, 0);
  });

  it("cả hai nguồn hỏng -> báo hỏng, kèm ĐÃ THỬ NHỮNG GÌ", async () => {
    const a = matGia("tikwm", [HONG_THU_LAI]);
    const b = matGia("yt-dlp", [HONG_THU_LAI]);

    const k = await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 4,
      nghiMs: 0,
      doi: KHONG_NGHI,
      chuoi: [a.mat, b.mat],
    });

    assert.equal(k.ok, false);
    if (!k.ok) {
      // Không có phần này thì lúc hỏng chỉ biết "hỏng", không biết hỏng ở đâu.
      assert.deepEqual(
        k.daThu.map((t) => t.nguon),
        ["tikwm", "yt-dlp"],
      );
      assert.match(k.loiChoLog, /tikwm/);
      assert.match(k.loiChoLog, /yt-dlp/);
    }
    assert.equal(a.dem.soLan, 4);
    assert.equal(b.dem.soLan, 4);
  });

  it("soLanThu = 0 vẫn gọi ĐÚNG MỘT lần, không bỏ qua nguồn", async () => {
    // Cấu hình lỗi không được biến thành "không thử gì cả rồi báo hỏng".
    const a = matGia("tikwm", [{ ok: true, video: videoGia("tikwm") }]);
    const k = await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 0,
      nghiMs: 0,
      doi: KHONG_NGHI,
      chuoi: [a.mat],
    });
    assert.equal(k.ok, true);
    assert.equal(a.dem.soLan, 1);
  });
});

describe("nhịp nghỉ - TikWM giới hạn 1 request/giây", () => {
  it("KHÔNG nghỉ sau lần thử CUỐI của một nguồn", async () => {
    // Nghỉ xong rồi bỏ nguồn đó đi là phí thời gian của người đang đợi, và nó
    // giữ suất trong hàng đợi song song (chỉ có 2 suất).
    const nghi: number[] = [];
    const a = matGia("tikwm", [HONG_THU_LAI]);

    await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 3,
      nghiMs: 1000,
      doi: async (ms) => {
        nghi.push(ms);
      },
      chuoi: [a.mat],
    });

    assert.equal(a.dem.soLan, 3);
    assert.equal(nghi.length, 2, "3 lần thử thì chỉ nghỉ 2 lần (giữa 1-2 và 2-3)");
    assert.deepEqual(nghi, [1000, 1000]);
  });

  it("thành công ngay lần đầu thì KHÔNG nghỉ lần nào", async () => {
    const nghi: number[] = [];
    const a = matGia("tikwm", [{ ok: true, video: videoGia("tikwm") }]);
    await layVideoQuaChuoi("u", "tiktok", {
      soLanThu: 4,
      nghiMs: 1000,
      doi: async (ms) => {
        nghi.push(ms);
      },
      chuoi: [a.mat],
    });
    assert.equal(nghi.length, 0);
  });
});
