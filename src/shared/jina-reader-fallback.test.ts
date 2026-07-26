import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "./test-env-setup.js";

let dataDir: string;
let jina: typeof import("./jina-reader-fallback.js");

before(async () => {
  dataDir = setupTestEnv();
  jina = await import("./jina-reader-fallback.js");
});

after(() => cleanupTestEnv(dataDir));

// Định dạng thật của r.jina.ai
const JINA_BODY = [
  "Title: Kết quả xổ số Đà Lạt 19/07/2026 - Minh Ngọc™",
  "URL Source: https://www.minhngoc.net.vn/",
  "Published Time: Sun, 19 Jul 2026 10:00:00 GMT",
  "",
  "Markdown Content:",
  "Giải ĐB | 087842",
  "Giải nhất | 47409",
].join("\n");

// Jina trả HTTP 200 kèm cảnh báo này khi trang đích chặn CHÍNH NÓ
const JINA_BLOCKED_BODY = [
  "Title: Attention Required! | Cloudflare",
  "URL Source: https://sjc.com.vn/giavang",
  "Warning: Target URL returned error 403: Forbidden",
].join("\n");

const respond = (body: string, status = 200) =>
  (async () => new Response(body, { status })) as typeof fetch;

describe("parseJinaResponse", () => {
  it("tách title và phần nội dung sau 'Markdown Content:'", () => {
    const parsed = jina.parseJinaResponse(JINA_BODY);
    assert.equal(parsed.title, "Kết quả xổ số Đà Lạt 19/07/2026 - Minh Ngọc™");
    assert.equal(parsed.text, "Giải ĐB | 087842\nGiải nhất | 47409");
    assert.ok(!parsed.text.includes("URL Source"), "phần header không được lẫn vào nội dung");
  });

  it("không có marker thì lấy nguyên body, không mất dữ liệu", () => {
    const parsed = jina.parseJinaResponse("chỉ có mỗi chữ này");
    assert.equal(parsed.text, "chỉ có mỗi chữ này");
    assert.equal(parsed.title, "");
  });
});

describe("fetchViaJinaReader", () => {
  it("lấy được nội dung khi Jina trả bình thường", async () => {
    const result = await jina.fetchViaJinaReader("https://minhngoc.net.vn/", {
      maxChars: 5000,
      fetchFn: respond(JINA_BODY),
    });
    assert.ok(result);
    assert.match(result.text, /087842/);
    assert.match(result.title, /Minh Ngọc/);
  });

  it("trang đích chặn cả Jina (200 + Warning) coi như thất bại, không trả rác cho model", async () => {
    const result = await jina.fetchViaJinaReader("https://sjc.com.vn/giavang", {
      maxChars: 5000,
      fetchFn: respond(JINA_BLOCKED_BODY),
    });
    assert.equal(result, null);
  });

  it("cắt theo maxChars để không phình context", async () => {
    const long = `Markdown Content:\n${"x".repeat(500)}`;
    const result = await jina.fetchViaJinaReader("https://a.vn", {
      maxChars: 100,
      fetchFn: respond(long),
    });
    assert.equal(result?.text.length, 100);
  });

  it("HTTP lỗi hoặc ném exception đều trả null - đây đã là nhánh lưới đỡ", async () => {
    assert.equal(
      await jina.fetchViaJinaReader("https://a.vn", { maxChars: 100, fetchFn: respond("nope", 429) }),
      null,
    );
    const throwing = (async () => {
      throw new Error("mạng chết");
    }) as typeof fetch;
    assert.equal(
      await jina.fetchViaJinaReader("https://a.vn", { maxChars: 100, fetchFn: throwing }),
      null,
    );
  });

  it("nội dung rỗng cũng trả null thay vì chuỗi trắng", async () => {
    const result = await jina.fetchViaJinaReader("https://a.vn", {
      maxChars: 100,
      fetchFn: respond("Markdown Content:\n   "),
    });
    assert.equal(result, null);
  });

  it("có key thì gắn Bearer, không key vẫn gọi được", async () => {
    const seen: (string | undefined)[] = [];
    const spy = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? undefined);
      return new Response(JINA_BODY);
    }) as typeof fetch;

    await jina.fetchViaJinaReader("https://a.vn", { maxChars: 100, fetchFn: spy });
    await jina.fetchViaJinaReader("https://a.vn", { maxChars: 100, apiKey: "jina-key", fetchFn: spy });

    assert.equal(seen[0], undefined, "không key thì không gửi Authorization");
    assert.equal(seen[1], "Bearer jina-key");
  });
});
