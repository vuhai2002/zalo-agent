import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Chốt chặn RÒ KHÓA API.
 *
 * `apiKey` và `baseUrl` luôn lấy từ cấu hình chung (per-agent key chưa có). Nên
 * một agent khai `modelProvider` khác provider chung sẽ khiến khóa của bên này
 * bị gửi sang endpoint của bên kia - lộ credential sang bên thứ ba, và bot câm
 * vì 401.
 *
 * Đây là bất biến AN NINH, không phải tiện nghi: giao diện có khóa ô chọn,
 * nhưng ô đó không khóa được khi chưa tải xong cấu hình chung, và biên API thì
 * ai gọi thẳng cũng lưu được. Chốt cuối phải nằm ở chỗ mọi đường đều đi qua.
 */

let dataDir: string;
let provider: typeof import("./llm-provider.js");

before(async () => {
  dataDir = setupTestEnv();
  provider = await import("./llm-provider.js");
});

after(async () => {
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

const CHUNG = { provider: "openai-compatible" as const, model: "gpt-combo" };

describe("doiProviderAnToan", () => {
  it("không override gì thì giữ nguyên cấu hình chung", () => {
    assert.deepEqual(provider.doiProviderAnToan(CHUNG), CHUNG);
  });

  it("override model mà KHÔNG đổi provider thì được nhận", () => {
    assert.deepEqual(provider.doiProviderAnToan(CHUNG, { modelName: "gpt-5.6-sol" }), {
      provider: "openai-compatible",
      model: "gpt-5.6-sol",
    });
  });

  it("override provider TRÙNG provider chung thì được nhận", () => {
    assert.deepEqual(
      provider.doiProviderAnToan(CHUNG, { modelProvider: "openai-compatible", modelName: "x" }),
      { provider: "openai-compatible", model: "x" },
    );
  });

  it("override provider LỆCH bị bỏ qua - đây là chốt chặn rò khóa", () => {
    const r = provider.doiProviderAnToan({ provider: "openai-compatible" as const, model: "gpt-combo" }, {
      modelProvider: "anthropic" as never,
      modelName: "claude-opus-5",
    });
    assert.equal(r.provider, "openai-compatible", "TUYỆT ĐỐI không được đổi sang provider không có khóa");
  });

  it("bị bỏ qua thì model cũng rơi về chung - tên model chọn CHO provider kia sẽ 400 ở đây", () => {
    const r = provider.doiProviderAnToan({ provider: "openai-compatible" as const, model: "gpt-combo" }, {
      modelProvider: "anthropic" as never,
      modelName: "claude-opus-5",
    });
    assert.equal(r.model, "gpt-combo");
  });

  it("chiều ngược lại cũng chặn: chung là anthropic, agent khai router", () => {
    const r = provider.doiProviderAnToan({ provider: "anthropic" as const, model: "claude-opus-5" }, {
      modelProvider: "openai-compatible" as never,
    });
    assert.equal(r.provider, "anthropic");
  });

  it("modelProvider null (đã bỏ override) không kích hoạt nhánh chặn", () => {
    assert.deepEqual(provider.doiProviderAnToan(CHUNG, { modelProvider: null, modelName: "y" }), {
      provider: "openai-compatible",
      model: "y",
    });
  });
});

/**
 * Google là nhà cung cấp thứ ba, thêm 06/08/2026. Chốt chặn rò khóa phải phủ
 * nó y như hai nhà kia - thêm provider mà quên nới chốt chặn là đúng kiểu lỗi
 * chỉ lộ ra khi có người thật cấu hình lệch.
 */
describe("doiProviderAnToan - google", () => {
  const GOOGLE = { provider: "google" as const, model: "gemini-3.5-flash-lite" };

  it("override provider TRÙNG (google/google) thì được nhận", () => {
    assert.deepEqual(provider.doiProviderAnToan(GOOGLE, { modelProvider: "google", modelName: "gemini-3.6-flash" }), {
      provider: "google",
      model: "gemini-3.6-flash",
    });
  });

  it("chung là router, agent khai google -> BỎ QUA, không gửi khóa router sang Google", () => {
    const r = provider.doiProviderAnToan(CHUNG, {
      modelProvider: "google" as never,
      modelName: "gemini-3.5-flash-lite",
    });
    assert.equal(r.provider, "openai-compatible");
    assert.equal(r.model, "gpt-combo", "tên model của Google gửi sang router chỉ nhận 400");
  });

  it("chung là google, agent khai router -> BỎ QUA chiều ngược lại", () => {
    const r = provider.doiProviderAnToan(GOOGLE, {
      modelProvider: "openai-compatible" as never,
      modelName: "gpt-combo",
    });
    assert.equal(r.provider, "google");
    assert.equal(r.model, "gemini-3.5-flash-lite");
  });
});
