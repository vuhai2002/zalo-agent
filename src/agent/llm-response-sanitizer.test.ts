import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSanitizingFetch, stripSseDoneTrailer } from "./llm-response-sanitizer.js";

// Body thật từ log lỗi 25/07: JSON hoàn chỉnh + đuôi SSE
const BUGGY_JSON = JSON.stringify({
  id: "ed24700c",
  object: "chat.completion",
  choices: [{ index: 0, message: { role: "assistant", content: "Chào Hải 👋 Có gì mình hỗ trợ bạn không?" } }],
});
const BUGGY_BODY = `${BUGGY_JSON}data: [DONE]\n\n`;

describe("stripSseDoneTrailer", () => {
  it("cắt đuôi 'data: [DONE]' khỏi JSON hoàn chỉnh, nội dung giữ nguyên", () => {
    const cleaned = stripSseDoneTrailer(BUGGY_BODY);
    assert.notEqual(cleaned, null);
    const parsed = JSON.parse(cleaned!);
    assert.equal(parsed.choices[0].message.content, "Chào Hải 👋 Có gì mình hỗ trợ bạn không?");
  });

  it("cắt được cả khi có nhiều đuôi DONE liên tiếp", () => {
    const cleaned = stripSseDoneTrailer(`${BUGGY_JSON}\ndata: [DONE]\n\ndata: [DONE]\n`);
    assert.notEqual(cleaned, null);
    assert.doesNotThrow(() => JSON.parse(cleaned!));
  });

  it("JSON sạch không có đuôi -> null (không đụng)", () => {
    assert.equal(stripSseDoneTrailer(BUGGY_JSON), null);
  });

  it("stream SSE thật -> null (phần còn lại không phải JSON object)", () => {
    const sse = `data: {"id":"1"}\n\ndata: {"id":"2"}\n\ndata: [DONE]\n\n`;
    assert.equal(stripSseDoneTrailer(sse), null);
  });

  it("đuôi DONE nhưng phần trước là JSON hỏng -> null", () => {
    assert.equal(stripSseDoneTrailer(`{"id": "1"data: [DONE]`), null);
  });
});

describe("createSanitizingFetch", () => {
  const buggyResponse = () =>
    new Response(BUGGY_BODY, {
      status: 200,
      headers: { "content-type": "text/event-stream", "content-length": "999" },
    });

  it("response lỗi được làm sạch: parse JSON được, content-type thành JSON", async () => {
    let sanitized = 0;
    const fetchFn = createSanitizingFetch({
      baseFetch: async () => buggyResponse(),
      onSanitized: () => sanitized++,
    });

    const res = await fetchFn("https://router.test/v1/chat/completions", { method: "POST", body: "{}" });
    const parsed = (await res.json()) as { choices: { message: { content: string } }[] };

    assert.equal(sanitized, 1);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(parsed.choices[0]!.message.content, "Chào Hải 👋 Có gì mình hỗ trợ bạn không?");
  });

  it("response JSON bình thường đi qua nguyên vẹn, không báo sanitized", async () => {
    let sanitized = 0;
    const fetchFn = createSanitizingFetch({
      baseFetch: async () => new Response(BUGGY_JSON, { status: 200, headers: { "content-type": "application/json" } }),
      onSanitized: () => sanitized++,
    });

    const res = await fetchFn("https://router.test", { method: "POST", body: "{}" });
    assert.equal(await res.text(), BUGGY_JSON);
    assert.equal(sanitized, 0);
  });

  it("request streaming thật không bị đụng tới (body chưa bị đọc)", async () => {
    const original = buggyResponse();
    const fetchFn = createSanitizingFetch({ baseFetch: async () => original });

    const res = await fetchFn("https://router.test", {
      method: "POST",
      body: '{"model":"m","stream":true}',
    });

    // Trả về đúng object gốc, body chưa consume -> stream reader còn dùng được
    assert.equal(res, original);
    assert.equal(res.bodyUsed, false);
  });

  it("response non-ok đi qua nguyên vẹn để SDK xử lý lỗi HTTP", async () => {
    const original = new Response("upstream error", { status: 502 });
    const fetchFn = createSanitizingFetch({ baseFetch: async () => original });

    const res = await fetchFn("https://router.test", { method: "POST", body: "{}" });
    assert.equal(res, original);
    assert.equal(res.status, 502);
  });
});
