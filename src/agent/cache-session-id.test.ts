import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cacheSessionHeaders,
  cacheSessionId,
  CACHE_SESSION_HEADER,
} from "./cache-session-id.js";

// Module thuần - import tĩnh được, không cần setupTestEnv

describe("cacheSessionId", () => {
  it("ỔN ĐỊNH: cùng thread luôn ra cùng khóa - đây là điều kiện để cache trúng", () => {
    const first = cacheSessionId("acc-chinh", "8771577400486544398");
    const second = cacheSessionId("acc-chinh", "8771577400486544398");
    assert.equal(first, second);
  });

  it("khác thread hoặc khác account thì khác khóa - không lẫn cache giữa các cuộc chat", () => {
    const a = cacheSessionId("acc-chinh", "thread-1");
    assert.notEqual(a, cacheSessionId("acc-chinh", "thread-2"));
    assert.notEqual(a, cacheSessionId("acc-hai", "thread-1"));
  });

  it("không rò thread id thật ra header (thread id là định danh người dùng)", () => {
    const threadId = "8771577400486544398";
    const key = cacheSessionId("acc-chinh", threadId);
    assert.ok(!key.includes(threadId), "khóa không được chứa thread id nguyên văn");
    assert.ok(!key.includes("acc-chinh"), "khóa không được chứa account id nguyên văn");
  });

  it("khóa đủ ngắn và chỉ chứa ký tự an toàn cho HTTP header", () => {
    const key = cacheSessionId("acc-chinh", "thread-1");
    assert.match(key, /^zalo-agent-[0-9a-f]{32}$/);
    assert.ok(key.length < 64);
  });

  it("ghép chuỗi không bị nhập nhằng ranh giới account/thread", () => {
    // "a:bc" và "ab:c" phải khác nhau, nếu không 2 thread khác nhau dùng chung cache
    assert.notEqual(cacheSessionId("a", "bc"), cacheSessionId("ab", "c"));
  });
});

describe("cacheSessionHeaders", () => {
  it("bật thì trả đúng header router đọc", () => {
    const headers = cacheSessionHeaders(true, "acc-chinh", "thread-1");
    assert.deepEqual(Object.keys(headers), [CACHE_SESSION_HEADER]);
    assert.equal(headers[CACHE_SESSION_HEADER], cacheSessionId("acc-chinh", "thread-1"));
  });

  it("tắt thì trả object rỗng để caller spread thẳng, không cần if", () => {
    assert.deepEqual(cacheSessionHeaders(false, "acc-chinh", "thread-1"), {});
  });

  it("thiếu accountId/threadId thì không gửi header rác", () => {
    assert.deepEqual(cacheSessionHeaders(true, "", "thread-1"), {});
    assert.deepEqual(cacheSessionHeaders(true, "acc-chinh", ""), {});
  });

  it("tên header khớp SESSION_HEADER_KEYS của 9Router - lệch là cache im lặng không chạy", () => {
    assert.equal(CACHE_SESSION_HEADER, "x-session-id");
  });
});
