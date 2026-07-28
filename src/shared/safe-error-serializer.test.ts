import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeErrorSafely } from "./safe-error-serializer.js";

/**
 * Bộ serialize mặc định của pino chép mọi thuộc tính enumerable, nên
 * `APICallError` lôi cả `requestBodyValues` (system prompt + hội thoại + ảnh
 * base64) ra file log. Test này giữ hàng rào đó đứng vững.
 */

/** Dựng đúng hình dạng APICallError của AI SDK: gán own property trong constructor */
class ApiCallErrorGia extends Error {
  url: string;
  statusCode: number;
  requestBodyValues: unknown;
  responseBody: string;
  constructor(anhBase64: string) {
    super("Too Many Requests");
    this.name = "AI_APICallError";
    this.url = "https://generativelanguage.googleapis.com/v1beta/chat/completions";
    this.statusCode = 429;
    this.requestBodyValues = {
      messages: [
        { role: "system", content: "Bạn là trợ lý AI... [TOÀN BỘ SYSTEM PROMPT]" },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${anhBase64}` } }] },
      ],
    };
    this.responseBody = '{"error":"quota exceeded"}';
  }
}

describe("serializeErrorSafely - chặn rò rỉ", () => {
  const anh = "iVBORw0KGgo" + "A".repeat(500);

  it("KHÔNG ghi requestBodyValues - đường rò system prompt và ảnh base64", () => {
    const ra = serializeErrorSafely(new ApiCallErrorGia(anh));
    assert.equal("requestBodyValues" in ra, false);
    const text = JSON.stringify(ra);
    assert.equal(text.includes(anh.slice(0, 50)), false, "ảnh base64 không được lọt");
    assert.equal(text.includes("TOÀN BỘ SYSTEM PROMPT"), false, "system prompt không được lọt");
  });

  it("KHÔNG ghi responseBody", () => {
    assert.equal("responseBody" in serializeErrorSafely(new ApiCallErrorGia(anh)), false);
  });

  it("VẪN giữ đủ thứ để chẩn đoán", () => {
    const ra = serializeErrorSafely(new ApiCallErrorGia(anh));
    assert.equal(ra.message, "Too Many Requests");
    assert.equal(ra.statusCode, 429);
    assert.match(String(ra.url), /googleapis\.com/);
    assert.equal(ra.type, "ApiCallErrorGia");
    assert.ok(String(ra.stack).length > 0, "stack là thứ lần ra chỗ ném lỗi");
  });

  it("ảnh Zalo cỡ thật không làm phình dòng log", () => {
    // Ảnh 300 KB -> base64 ~400 KB. Đây là kích thước thật của ảnh Zalo gửi ở
    // chế độ `normal`, và sidecar đọc ảnh dính 429 free tier khá thường xuyên.
    const anhThat = "A".repeat(400_000);
    const err = new ApiCallErrorGia(anhThat);
    const antoan = JSON.stringify(serializeErrorSafely(err));
    assert.ok(antoan.length < 4000, `dòng log phải nhỏ, thực tế ${antoan.length} ký tự`);
    assert.equal(antoan.includes("AAAAAAAAAA"), false, "không được dính mảnh ảnh nào");
  });
});

describe("serializeErrorSafely - không được tự làm hỏng log", () => {
  it("lấy được message dù nó là non-enumerable", () => {
    assert.equal(serializeErrorSafely(new Error("mạng rớt")).message, "mạng rớt");
  });

  it("giữ code/errno/syscall của lỗi Node - cần khi lỗi đọc ghi file", () => {
    const e = Object.assign(new Error("ENOENT"), { code: "ENOENT", errno: -4058, syscall: "open" });
    const ra = serializeErrorSafely(e);
    assert.equal(ra.code, "ENOENT");
    assert.equal(ra.syscall, "open");
  });

  it("theo được chuỗi cause nhưng cause cũng bị lọc", () => {
    const goc = new ApiCallErrorGia("XYZ".repeat(50));
    const ra = serializeErrorSafely(new Error("bọc ngoài", { cause: goc }));
    const cause = ra.cause as Record<string, unknown>;
    assert.equal(cause.statusCode, 429);
    assert.equal("requestBodyValues" in cause, false, "cause phải lọc như lỗi gốc");
  });

  it("cause tự tham chiếu không làm treo", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    a.cause = a;
    assert.ok(serializeErrorSafely(a).message === "a", "phải trả về, không lặp vô hạn");
  });

  it("giá trị không phải Error vẫn ra được thứ đọc được", () => {
    assert.equal(serializeErrorSafely("chuỗi trần").message, "chuỗi trần");
    assert.equal(serializeErrorSafely(undefined).message, "undefined");
    assert.equal(serializeErrorSafely(null).message, "null");
  });

  it("stack quá dài bị cắt", () => {
    const e = new Error("x");
    e.stack = "y".repeat(5000);
    assert.ok(String(serializeErrorSafely(e).stack).length < 2100);
  });

  it("ZaloApiError giữ nguyên message và code - không bị lọc oan", () => {
    const e = Object.assign(new Error("Không gửi được tin"), { code: 118 });
    const ra = serializeErrorSafely(e);
    assert.equal(ra.message, "Không gửi được tin");
    assert.equal(ra.code, 118);
  });
});
