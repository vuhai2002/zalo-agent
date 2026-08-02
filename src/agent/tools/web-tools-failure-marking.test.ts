import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import { ketQuaThanhCong, loiCuaTool } from "./tool-failure-result-test-helper.js";

/**
 * `web_fetch` và `web_search` là hai tool được lấy làm bằng chứng cho việc guard
 * chống lặp bị câm ("hỏng trên 8 URL khác nhau"), nhưng cả hai chưa từng có file
 * test nào. Nghĩa là quy ước `ketQuaLoi` ở đúng hai tool quan trọng nhất không
 * có gì canh: quên bọc, hoặc bọc nhầm nhánh thành công, đều không đỏ.
 *
 * File này kiểm CẢ HAI CHIỀU cho mỗi tool - hỏng phải đánh dấu, thành công phải
 * là chuỗi trần. Đánh dấu nhầm chiều nào cũng tệ: quên thì guard câm, thừa thì
 * guard chặn oan lượt đang chạy tốt.
 *
 * KHÔNG chạm mạng thật:
 *   - web_search: thay `globalThis.fetch`.
 *   - web_fetch: dùng URL loopback để chính guard SSRF của `safe-remote-download`
 *     chặn trước khi mở kết nối, và tắt bậc 2 (Jina) để không có đường ra ngoài.
 */

let dataDir: string;
let database: typeof import("../../conversation/database.js");
let toolSettings: typeof import("../../config/runtime-tool-settings.js");
let webSearch: typeof import("./web-search-tool.js");
let webFetch: typeof import("./web-fetch-tool.js");

const fetchThat = globalThis.fetch;

before(async () => {
  dataDir = setupTestEnv();
  // Import ĐỘNG sau setupTestEnv: các module này chạm DB qua runtime-tool-settings
  database = await import("../../conversation/database.js");
  toolSettings = await import("../../config/runtime-tool-settings.js");
  webSearch = await import("./web-search-tool.js");
  webFetch = await import("./web-fetch-tool.js");
});

after(() => {
  globalThis.fetch = fetchThat;
  // Đóng SQLite trước khi xóa thư mục: Windows khóa file đang mở -> EPERM
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const chay = (tool: unknown, input: unknown): Promise<unknown> =>
  (tool as any).execute(input, {});

const datFetch = (body: string, ok = true) => {
  globalThis.fetch = (async () =>
    new Response(body, { status: ok ? 200 : 500 })) as unknown as typeof fetch;
};

const trangDdg = (soKetQua: number) =>
  Array.from(
    { length: soKetQua },
    (_, i) =>
      `<a class="result__a" href="https://vd${i}.test/bai">Tiêu đề ${i}</a>` +
      `<a class="result__snippet">Mô tả ${i}</a>`,
  ).join("\n");

describe("web_search - đánh dấu đúng cả hai chiều", () => {
  it("không có kết quả nào -> nhánh HỎNG có đánh dấu", async () => {
    // Chuỗi provider nuốt lỗi rồi trả mảng rỗng, nên "rỗng" ở đây vừa có thể là
    // thật sự không có gì, vừa có thể là dịch vụ tìm kiếm đang chết - cả hai đều
    // là lượt gọi không mang về gì, và lặp lại thì phải bị đếm.
    datFetch("<html><body>không có kết quả</body></html>");
    const ra = await chay(webSearch.createWebSearchTool(), { query: "từ khóa lạ" });
    assert.match(loiCuaTool(ra), /Không tìm thấy kết quả nào/);
  });

  it("dịch vụ trả 500 (mọi provider chết) cũng ra nhánh hỏng, KHÔNG ném ra agent loop", async () => {
    datFetch("", false);
    const ra = await chay(webSearch.createWebSearchTool(), { query: "giá vàng" });
    assert.ok(loiCuaTool(ra).length > 0);
  });

  it("có kết quả -> chuỗi trần, KHÔNG được đánh dấu hỏng", async () => {
    datFetch(trangDdg(3));
    const ra = await chay(webSearch.createWebSearchTool(), { query: "giá vàng" });
    const text = ketQuaThanhCong(ra);
    assert.match(text, /vd0\.test/);
    // Bọc chống prompt injection phải còn nguyên - đây là nội dung bên ngoài
    assert.match(text, /noi_dung_ngoai/);
  });
});

describe("web_fetch - đánh dấu đúng cả hai chiều", () => {
  it("không đọc được trang -> nhánh HỎNG có đánh dấu", async () => {
    // Bậc 2 tắt nên không có đường ra mạng; URL loopback bị guard SSRF chặn ngay
    toolSettings.updateFetchSettings({ fallbackEnabled: false });
    const ra = await chay(webFetch.createWebFetchTool(), { url: "http://127.0.0.1:9/khong-co" });
    assert.match(loiCuaTool(ra), /Không đọc được trang/);
  });

  it("URL nội bộ bị chặn SSRF vẫn là nhánh hỏng đọc được, không phải exception", async () => {
    toolSettings.updateFetchSettings({ fallbackEnabled: false });
    // 169.254.169.254 là endpoint metadata của máy ảo đám mây - ca kinh điển
    const ra = await chay(webFetch.createWebFetchTool(), {
      url: "http://169.254.169.254/latest/meta-data/",
    });
    assert.ok(loiCuaTool(ra).length > 0);
  });
});
