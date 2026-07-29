import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "./test-env-setup.js";

let dataDir: string;
let providers: typeof import("./web-search-providers.js");

before(async () => {
  dataDir = setupTestEnv();
  providers = await import("./web-search-providers.js");
});

after(() => cleanupTestEnv(dataDir));

// Trích từ HTML thật của html.duckduckgo.com (rút gọn) - đúng selector result__a
const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvnexpress.net%2Ftin-tuc&amp;rut=abc123">Tin tức <b>mới nhất</b></a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvnexpress.net%2Ftin-tuc">Báo <b>VnExpress</b> - tin nhanh &amp; nóng</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://tuoitre.vn/">Tuổi Trẻ Online</a>
  <a class="result__snippet" href="https://tuoitre.vn/">Tin tức 24h</a>
</div>`;

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("parseDdgHtml + unwrapDdgRedirect", () => {
  it("bóc title/url/snippet, giải redirect uddg về URL thật", () => {
    const results = providers.parseDdgHtml(DDG_HTML, 5);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], {
      title: "Tin tức mới nhất",
      url: "https://vnexpress.net/tin-tuc",
      snippet: "Báo VnExpress - tin nhanh & nóng",
    });
    assert.equal(results[1]!.url, "https://tuoitre.vn/");
  });

  it("tôn trọng maxResults", () => {
    assert.equal(providers.parseDdgHtml(DDG_HTML, 1).length, 1);
  });

  it("HTML không có kết quả trả mảng rỗng, không throw", () => {
    assert.deepEqual(providers.parseDdgHtml("<html><body>No results.</body></html>", 5), []);
  });

  it("unwrapDdgRedirect giữ nguyên URL thường", () => {
    assert.equal(providers.unwrapDdgRedirect("https://tuoitre.vn/"), "https://tuoitre.vn/");
  });
});

describe("searchWeb - chuỗi provider", () => {
  it("không có key Brave: đi thẳng DuckDuckGo bằng POST form (GET bị challenge)", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const fetchFn = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push({ url: String(url), method: init?.method, body: String(init?.body ?? "") });
      return new Response(DDG_HTML);
    }) as typeof fetch;

    const results = await providers.searchWeb("tin tức", { maxResults: 5, fetchFn });
    assert.equal(results.length, 2);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /duckduckgo\.com/);
    assert.equal(calls[0]!.method, "POST", "GET trần bị DDG trả trang challenge");
    assert.match(calls[0]!.body!, /q=tin/);
  });

  it("có key Brave: Brave trước, map đúng kết quả", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: Parameters<typeof fetch>[0]) => {
      urls.push(String(url));
      return jsonResponse({
        web: { results: [{ title: "Kết quả <b>Brave</b>", url: "https://a.vn", description: "mô tả" }] },
      });
    }) as typeof fetch;

    const results = await providers.searchWeb("q", { maxResults: 5, braveApiKey: "key", fetchFn });
    assert.deepEqual(results, [{ title: "Kết quả Brave", url: "https://a.vn", snippet: "mô tả" }]);
    assert.match(urls[0]!, /api\.search\.brave\.com/);
  });

  it("Brave lỗi (hết quota 429) thì rơi về DuckDuckGo, không throw", async () => {
    const fetchFn = (async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).includes("brave")) return new Response("quota", { status: 429 });
      return new Response(DDG_HTML);
    }) as typeof fetch;

    const results = await providers.searchWeb("q", { maxResults: 5, braveApiKey: "key", fetchFn });
    assert.equal(results.length, 2, "phải có kết quả từ DDG dù Brave chết");
  });

  it("mọi provider chết: trả mảng rỗng để tool tự diễn giải, không ném ra agent", async () => {
    const fetchFn = (async () => new Response("die", { status: 500 })) as typeof fetch;
    const results = await providers.searchWeb("q", { maxResults: 5, braveApiKey: "key", fetchFn });
    assert.deepEqual(results, []);
  });
});
