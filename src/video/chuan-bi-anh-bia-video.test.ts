import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Dựng poster = tải ảnh bìa nguồn -> upload lên Zalo -> trả URL Zalo.
 *
 * Mọi luật đến từ đo thật tới điện thoại:
 *   - URL ảnh host ngoài -> thẻ video đen thui, nên PHẢI upload, không đưa thẳng.
 *   - Không dựng được thì trả `null` (caller lùi sang gửi file), TUYỆT ĐỐI không
 *     ném - mất poster thì còn gửi file, ném là mất cả video.
 */

let dataDir: string;
let mod: typeof import("./chuan-bi-anh-bia-video.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./chuan-bi-anh-bia-video.js");
});

after(() => cleanupTestEnv(dataDir));

/** PNG 1x1 hợp lệ để `readImageSize` đọc ra kích thước */
function pngNho(w: number, h: number): Buffer {
  const b = Buffer.alloc(26);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

const POSTER_ZALO = "https://f120-zpc.zdn.vn/abc/poster.jpg";

/* eslint-disable @typescript-eslint/no-explicit-any */
function dichVoi(uploadAttachment: (...a: any[]) => Promise<unknown>) {
  return { api: { uploadAttachment }, threadId: "t1", threadType: 0 } as any;
}

describe("dựng poster từ ảnh bìa nguồn", () => {
  it("tải ảnh -> upload lên Zalo -> trả normalUrl", async () => {
    let daUpload = false;
    const dich = dichVoi(async (ds: { data: Buffer; metadata: { width: number; height: number } }[]) => {
      daUpload = true;
      // Đọc đúng kích thước từ ảnh, không bịa
      assert.deepEqual(
        { w: ds[0]!.metadata.width, h: ds[0]!.metadata.height },
        { w: 960, h: 540 },
      );
      return [{ normalUrl: POSTER_ZALO }];
    });
    const r = await mod.chuanBiAnhBiaVideo(dich, "https://cdn/cover.png", {
      taiAnh: async () => pngNho(960, 540),
    });
    assert.equal(r, POSTER_ZALO);
    assert.ok(daUpload);
  });

  it("chấp nhận hdUrl/thumbUrl khi thiếu normalUrl", async () => {
    const dich = dichVoi(async () => [{ hdUrl: POSTER_ZALO }]);
    const r = await mod.chuanBiAnhBiaVideo(dich, "https://cdn/c.png", { taiAnh: async () => pngNho(10, 10) });
    assert.equal(r, POSTER_ZALO);
  });
});

describe("trả null (lùi sang gửi file), KHÔNG ném", () => {
  it("không có ảnh bìa nguồn (chuỗi rỗng)", async () => {
    let goiTai = false;
    const r = await mod.chuanBiAnhBiaVideo(dichVoi(async () => [{ normalUrl: POSTER_ZALO }]), "", {
      taiAnh: async () => {
        goiTai = true;
        return pngNho(10, 10);
      },
    });
    assert.equal(r, null);
    assert.ok(!goiTai, "rỗng thì đừng tải gì cả");
  });

  it("tải ảnh hỏng (trả null)", async () => {
    const r = await mod.chuanBiAnhBiaVideo(dichVoi(async () => [{ normalUrl: POSTER_ZALO }]), "https://x", {
      taiAnh: async () => null,
    });
    assert.equal(r, null);
  });

  it("đọc không ra kích thước (vd WebP) thì bỏ, không upload", async () => {
    let goiUpload = false;
    const r = await mod.chuanBiAnhBiaVideo(
      dichVoi(async () => {
        goiUpload = true;
        return [{ normalUrl: POSTER_ZALO }];
      }),
      "https://x",
      { taiAnh: async () => Buffer.from("RIFF....WEBP khong doc duoc kich thuoc") },
    );
    assert.equal(r, null);
    assert.ok(!goiUpload, "không đọc được kích thước thì đừng upload");
  });

  it("upload NÉM thì nuốt, trả null", async () => {
    const r = await mod.chuanBiAnhBiaVideo(
      dichVoi(async () => {
        throw new Error("Zalo từ chối ảnh");
      }),
      "https://x",
      { taiAnh: async () => pngNho(10, 10) },
    );
    assert.equal(r, null);
  });

  it("upload trả về không có URL nào thì null", async () => {
    const r = await mod.chuanBiAnhBiaVideo(dichVoi(async () => [{}]), "https://x", {
      taiAnh: async () => pngNho(10, 10),
    });
    assert.equal(r, null);
  });
});
