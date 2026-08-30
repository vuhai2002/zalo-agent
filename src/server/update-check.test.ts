import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setupTestEnv } from "../shared/test-env-setup.js";

// database.ts / runtime-tuning-settings.ts mở SQLite ở module scope - phải
// setupTestEnv() TRƯỚC rồi mới import động (bẫy test ghi trong CLAUDE.md).
let mod: typeof import("./update-check.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");

const OR = { owner: "vuhai2002", repo: "zalo-agent" };

/** fetch giả trả một JSON + status định sẵn, không chạm mạng */
function fetchGia(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("layBanMoiNhat", () => {
  before(async () => {
    setupTestEnv();
    mod = await import("./update-check.js");
    tuning = await import("../config/runtime-tuning-settings.js");
  });
  beforeEach(() => {
    mod._resetCacheChoTest();
    tuning.setTuning("UPDATE_CHECK_ENABLED", null);
    tuning.setTuning("UPDATE_CHECK_INTERVAL_MINUTES", null);
  });
  after(() => {
    tuning.setTuning("UPDATE_CHECK_ENABLED", null);
    tuning.setTuning("UPDATE_CHECK_INTERVAL_MINUTES", null);
  });

  it("toggle tắt -> {enabled:false} và KHÔNG gọi mạng", async () => {
    tuning.setTuning("UPDATE_CHECK_ENABLED", false);
    let goi = false;
    const fetchFn = (async () => {
      goi = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const kq = await mod.layBanMoiNhat({ fetchFn, ownerRepo: OR });
    assert.equal(kq.enabled, false);
    assert.equal(kq.latest, null);
    assert.equal(goi, false);
  });

  it("thành công -> latest bỏ tiền tố v + releaseUrl tự dựng", async () => {
    const kq = await mod.layBanMoiNhat({ fetchFn: fetchGia({ tag_name: "v0.3.0" }), ownerRepo: OR });
    assert.equal(kq.enabled, true);
    assert.equal(kq.latest, "0.3.0");
    assert.equal(kq.releaseUrl, "https://github.com/vuhai2002/zalo-agent/releases/tag/v0.3.0");
  });

  it("HTTP lỗi (404/500) -> fail-soft, latest null", async () => {
    const k404 = await mod.layBanMoiNhat({ fetchFn: fetchGia({}, 404), ownerRepo: OR });
    assert.equal(k404.enabled, true);
    assert.equal(k404.latest, null);
    mod._resetCacheChoTest();
    const k500 = await mod.layBanMoiNhat({ fetchFn: fetchGia({}, 500), ownerRepo: OR });
    assert.equal(k500.latest, null);
  });

  it("fetch ném (timeout/mạng) -> fail-soft, latest null", async () => {
    const fetchFn = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const kq = await mod.layBanMoiNhat({ fetchFn, ownerRepo: OR });
    assert.equal(kq.enabled, true);
    assert.equal(kq.latest, null);
  });

  it("tag_name thiếu/không phải chuỗi -> latest null", async () => {
    const kq = await mod.layBanMoiNhat({ fetchFn: fetchGia({ name: "0.3.0" }), ownerRepo: OR });
    assert.equal(kq.latest, null);
  });

  it("cache: gọi 2 lần trong cửa sổ -> chỉ fetch 1 lần", async () => {
    let dem = 0;
    const fetchFn = (async () => {
      dem++;
      return new Response(JSON.stringify({ tag_name: "v0.3.0" }));
    }) as unknown as typeof fetch;
    await mod.layBanMoiNhat({ fetchFn, ownerRepo: OR });
    await mod.layBanMoiNhat({ fetchFn, ownerRepo: OR });
    assert.equal(dem, 1);
  });

  it("hết nhịp UPDATE_CHECK_INTERVAL_MINUTES -> fetch lại", async () => {
    tuning.setTuning("UPDATE_CHECK_INTERVAL_MINUTES", 10);
    let dem = 0;
    let t = 1000;
    const fetchFn = (async () => {
      dem++;
      return new Response(JSON.stringify({ tag_name: "v0.3.0" }));
    }) as unknown as typeof fetch;
    const now = () => t;
    await mod.layBanMoiNhat({ fetchFn, ownerRepo: OR, now });
    t += 11 * 60 * 1000; // qua 11 phút > nhịp 10 phút -> cache hết hạn
    await mod.layBanMoiNhat({ fetchFn, ownerRepo: OR, now });
    assert.equal(dem, 2);
  });

  it("ownerRepo null -> latest null, không fetch", async () => {
    let goi = false;
    const fetchFn = (async () => {
      goi = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const kq = await mod.layBanMoiNhat({ fetchFn, ownerRepo: null });
    assert.equal(kq.latest, null);
    assert.equal(goi, false);
  });

  it("không tiêm ownerRepo -> đọc owner/repo thật từ package.json", async () => {
    const kq = await mod.layBanMoiNhat({ fetchFn: fetchGia({ tag_name: "v9.9.9" }) });
    assert.equal(kq.releaseUrl, "https://github.com/vuhai2002/zalo-agent/releases/tag/v9.9.9");
  });
});
