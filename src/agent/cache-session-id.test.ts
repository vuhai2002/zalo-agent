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
    const first = cacheSessionId("acc-chinh", "1234567890123456789");
    const second = cacheSessionId("acc-chinh", "1234567890123456789");
    assert.equal(first, second);
  });

  it("khác thread hoặc khác account thì khác khóa - không lẫn cache giữa các cuộc chat", () => {
    const a = cacheSessionId("acc-chinh", "thread-1");
    assert.notEqual(a, cacheSessionId("acc-chinh", "thread-2"));
    assert.notEqual(a, cacheSessionId("acc-hai", "thread-1"));
  });

  it("không rò thread id thật ra header (thread id là định danh người dùng)", () => {
    const threadId = "1234567890123456789";
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

/**
 * Epoch là số lần ngữ cảnh thread bị xóa sạch. Nó ở trong phần băm để mỗi lần
 * xóa mở một PHIÊN MỚI với router - cùng cách goclaw gọi `ResetCLISession` sau
 * /reset và Hermes xoay `session_id`. Thiếu nó thì xóa xong vẫn gửi đúng khóa
 * cũ, và router giữ tiền tố đã cache của cuộc trò chuyện vừa bị xóa.
 */
describe("cacheSessionId - epoch sau khi xóa ngữ cảnh", () => {
  it("epoch khác nhau thì khóa khác nhau", () => {
    const truoc = cacheSessionId("acc", "th", 0);
    const sau = cacheSessionId("acc", "th", 1);
    assert.notEqual(truoc, sau, "xóa ngữ cảnh xong phải là phiên mới");
  });

  it("KHÔNG truyền epoch thì giữ nguyên khóa cũ - thread chưa từng xóa không mất cache", () => {
    assert.equal(cacheSessionId("acc", "th"), cacheSessionId("acc", "th", 0));
  });

  it("cùng epoch thì vẫn ổn định - trong một phiên cache phải trúng", () => {
    assert.equal(cacheSessionId("acc", "th", 3), cacheSessionId("acc", "th", 3));
  });

  it("epoch không lẫn sang phần account/thread", () => {
    // Ghép chuỗi ẩu ("acc:th" + "1" so với "acc:th1" + "") là hai thread khác
    // nhau ra cùng khóa, tức là cache của người này chảy sang người kia
    assert.notEqual(cacheSessionId("acc", "th", 1), cacheSessionId("acc", "th1", 0));
  });

  it("header cũng đổi theo epoch, không chỉ hàm băm", () => {
    const h0 = cacheSessionHeaders(true, "acc", "th", 0)[CACHE_SESSION_HEADER];
    const h1 = cacheSessionHeaders(true, "acc", "th", 1)[CACHE_SESSION_HEADER];
    assert.notEqual(h0, h1, "quên truyền epoch xuống header là vá nửa vời");
  });
});
