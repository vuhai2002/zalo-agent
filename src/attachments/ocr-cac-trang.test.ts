import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHourlyRateLimit } from "../shared/hourly-rate-limit.js";
import { ocrCacTrang, type PhuThuocOcr } from "./ocr-cac-trang.js";

function phuThuoc(p: Partial<PhuThuocOcr> & { tranGio?: number } = {}): PhuThuocOcr & { soDongThoi: () => number } {
  let dangChay = 0;
  let dinh = 0;
  return {
    sidecarSanSang: () => true,
    render: async (_buf, so) => so.map((s) => ({ so: s, jpeg: new Uint8Array([0xff, 0xd8, s]) })),
    chep: async (anh) => {
      dangChay++;
      dinh = Math.max(dinh, dangChay);
      await new Promise((r) => setTimeout(r, 5));
      dangChay--;
      return { text: `chu trang ${anh.base64}`, truncated: false };
    },
    gioiHan: createHourlyRateLimit({ limit: () => p.tranGio ?? 100, buildReason: () => "hết" }),
    songSong: 2,
    soDongThoi: () => dinh,
    ...p,
  };
}

describe("ocrCacTrang - OCR nhiều trang có trần", () => {
  it("trần giờ 5, xin 7 trang (lộn thứ tự) -> 5 trang ĐẦU được chép, 2 trang cuối het-tran-gio", async () => {
    const d = phuThuoc({ tranGio: 5 });
    const kq = await ocrCacTrang(Buffer.alloc(1), [7, 1, 2, 3, 4, 5, 6], "a:u1", d);
    assert.deepEqual(kq.trang.map((t) => t.so), [1, 2, 3, 4, 5]);
    assert.deepEqual(kq.boQua, [
      { so: 6, lyDo: "het-tran-gio" },
      { so: 7, lyDo: "het-tran-gio" },
    ]);
  });

  it("không quá songSong lời gọi vision cùng lúc", async () => {
    const d = phuThuoc();
    await ocrCacTrang(Buffer.alloc(1), [1, 2, 3, 4, 5, 6], "a:u2", d);
    assert.ok(d.soDongThoi() <= 2, `đồng thời ${d.soDongThoi()}`);
    assert.ok(d.soDongThoi() >= 2, "phải tận dụng song song");
  });

  it("một trang lỗi -> loi và được hoàn suất (gọi lại ngay trong giờ vẫn đủ suất)", async () => {
    let lan = 0;
    const d = phuThuoc({
      tranGio: 2,
      chep: async (anh) => (anh.base64 === Buffer.from([0xff, 0xd8, 2]).toString("base64") && lan++ === 0 ? null : { text: "ok", truncated: false }),
    });
    const kq1 = await ocrCacTrang(Buffer.alloc(1), [1, 2], "a:u3", d);
    assert.deepEqual(kq1.boQua, [{ so: 2, lyDo: "loi" }]);
    const kq2 = await ocrCacTrang(Buffer.alloc(1), [2], "a:u3", d);
    assert.deepEqual(kq2.boQua, [], "trang lỗi không được ăn suất");
    assert.equal(kq2.trang.length, 1);
  });

  it("sidecar chưa cấu hình -> mọi trang chua-cau-hinh, không render, không tốn suất", async () => {
    let daRender = false;
    const d = phuThuoc({
      tranGio: 1,
      sidecarSanSang: () => false,
      render: async () => {
        daRender = true;
        return [];
      },
    });
    const kq = await ocrCacTrang(Buffer.alloc(1), [1, 2], "a:u4", d);
    assert.deepEqual(kq.boQua.map((b) => b.lyDo), ["chua-cau-hinh", "chua-cau-hinh"]);
    assert.equal(daRender, false);
    assert.equal(d.gioiHan.check("a:u4").ok, true, "không được trừ suất");
  });

  it("render hỏng (tiến trình con bị giết) -> mọi trang loi, hoàn suất, không ném", async () => {
    const d = phuThuoc({
      tranGio: 2,
      render: async () => {
        throw new Error("vượt trần bộ nhớ");
      },
    });
    const kq = await ocrCacTrang(Buffer.alloc(1), [1, 2], "a:u5", d);
    assert.deepEqual(kq.boQua.map((b) => b.lyDo), ["loi", "loi"]);
    assert.equal(d.gioiHan.check("a:u5").ok, true);
  });

  it("render theo cụm 5 trang: cụm chứa trang độc hỏng thì CHỈ cụm đó mất", async () => {
    const cacCum: number[][] = [];
    const d = phuThuoc({
      render: async (_buf, so) => {
        cacCum.push(so);
        if (so.includes(6)) throw new Error("bị giết vì vượt RAM");
        return so.map((s) => ({ so: s, jpeg: new Uint8Array([0xff, 0xd8, s]) }));
      },
    });
    const kq = await ocrCacTrang(Buffer.alloc(1), [1, 2, 3, 4, 5, 6, 7], "a:u7", d);
    assert.deepEqual(cacCum, [
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
    assert.deepEqual(kq.trang.map((t) => t.so), [1, 2, 3, 4, 5]);
    assert.deepEqual(kq.boQua.map((b) => [b.so, b.lyDo]), [
      [6, "loi"],
      [7, "loi"],
    ]);
  });

  it("trang bị cắt vì chạm trần output -> cut true", async () => {
    const d = phuThuoc({ chep: async () => ({ text: "dở", truncated: true }) });
    const kq = await ocrCacTrang(Buffer.alloc(1), [1], "a:u6", d);
    assert.deepEqual(kq.trang, [{ so: 1, chu: "dở", cut: true }]);
  });
});
