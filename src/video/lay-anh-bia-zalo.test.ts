import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Xin Zalo một ảnh bìa nằm trên CDN của chính họ.
 *
 * VÌ SAO: đưa `sendVideo` một `thumbnailUrl` trỏ host ngoài thì thẻ video hiện
 * ĐEN THUI - Zalo rất kén host ảnh. `parseLink` là API Zalo dùng để dựng thẻ
 * xem trước khi người dùng dán link, và nó trả về ảnh Zalo đã tự lưu, nên ta
 * xin lại được mà KHÔNG tốn byte nào.
 *
 * Luật xuyên suốt: ảnh bìa là thứ làm cho đẹp, KHÔNG phải điều kiện để gửi.
 * Mọi nhánh hỏng phải trả `null` chứ không được ném - ném là mất cả video vì
 * một cái ảnh.
 */

let dataDir: string;
let mod: typeof import("./lay-anh-bia-zalo.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./lay-anh-bia-zalo.js");
});

after(() => cleanupTestEnv(dataDir));

/* eslint-disable @typescript-eslint/no-explicit-any */
const apiVoi = (parseLink: (u: string) => Promise<unknown>) => ({ parseLink }) as any;

const THUMB_ZALO = "https://photo-link-talk.zadn.vn/photolinkv2/720/zlv2abc";

describe("chỉ nhận ảnh nằm trên hạ tầng Zalo", () => {
  it("nhận host zadn.vn - đây là ảnh Zalo tự lưu", async () => {
    const r = await mod.layAnhBiaZalo(apiVoi(async () => ({ data: { thumb: THUMB_ZALO } })), "https://x");
    assert.equal(r, THUMB_ZALO);
  });

  it("TỪ CHỐI ảnh vẫn nằm ở host ngoài - nó chẳng hơn gì ảnh ta đã có", async () => {
    // Nếu Zalo trả lại chính URL của TikTok thì dùng nó cũng đen thui như cũ.
    for (const u of [
      "https://p16-common-sign.tiktokcdn.com/abc.jpg",
      "https://scontent.fsgn2-4.fna.fbcdn.net/v/t15.jpg",
      "http://zadn.vn.ke-tan-cong.net/x.jpg",
    ]) {
      const r = await mod.layAnhBiaZalo(apiVoi(async () => ({ data: { thumb: u } })), "https://x");
      assert.equal(r, null, `phải từ chối: ${u}`);
    }
  });

  it("hỏi bằng đúng URL được truyền vào", async () => {
    let daHoi = "";
    await mod.layAnhBiaZalo(
      apiVoi(async (u: string) => {
        daHoi = u;
        return { data: { thumb: THUMB_ZALO } };
      }),
      "https://vt.tiktok.com/ABC/",
    );
    assert.equal(daHoi, "https://vt.tiktok.com/ABC/");
  });
});

describe("hỏng thì trả null, TUYỆT ĐỐI không ném", () => {
  it("parseLink ném", async () => {
    const r = await mod.layAnhBiaZalo(
      apiVoi(async () => {
        throw new Error("mạng đứt");
      }),
      "https://x",
    );
    assert.equal(r, null);
  });

  it("phản hồi thiếu trường, rỗng, hoặc sai kiểu", async () => {
    for (const than of [{}, { data: {} }, { data: { thumb: "" } }, { data: { thumb: 123 } }, null]) {
      const r = await mod.layAnhBiaZalo(apiVoi(async () => than), "https://x");
      assert.equal(r, null, JSON.stringify(than));
    }
  });

  it("API không có parseLink cũng không làm hỏng lượt gửi", async () => {
    const r = await mod.layAnhBiaZalo({} as any, "https://x");
    assert.equal(r, null);
  });
});
