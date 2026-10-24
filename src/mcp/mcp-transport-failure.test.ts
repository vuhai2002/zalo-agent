import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MCPClientError } from "@ai-sdk/mcp";
import { laLoiMatKetNoiMcp } from "./mcp-transport-failure.js";

describe("laLoiMatKetNoiMcp", () => {
  it("lỗi tầng HTTP (có statusCode) -> mất kết nối", () => {
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "x", statusCode: 404 })), true);
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "x", statusCode: 502 })), true);
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "x", statusCode: 401 })), true);
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "x", statusCode: 403 })), true);
  });

  it("400/413/429 và 200 'Unexpected content type' KHÔNG phải mất phiên - không nối lại oan", () => {
    for (const ma of [400, 413, 429, 200]) {
      assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "x", statusCode: ma })), false, String(ma));
    }
  });

  it("client đã đóng -> mất kết nối", () => {
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "Connection closed" })), true);
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "Attempted to send a request from a closed client" })), true);
  });

  it("undici không tới được máy chủ -> mất kết nối", () => {
    assert.equal(laLoiMatKetNoiMcp(new TypeError("fetch failed")), true);
  });

  it("lỗi JSON-RPC có code THẮNG statusCode -> server còn sống", () => {
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "invalid params", code: -32602 })), false);
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "x", code: -32603, statusCode: 500 })), false);
  });

  it("hết giờ / hủy / sai schema / lỗi thường -> KHÔNG đánh", () => {
    assert.equal(laLoiMatKetNoiMcp(new Error("quá 1000ms")), false);
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "Request was aborted" })), false);
    assert.equal(laLoiMatKetNoiMcp(new MCPClientError({ message: "Failed to parse server response" })), false);
    assert.equal(laLoiMatKetNoiMcp(new TypeError("x is not a function")), false);
    assert.equal(laLoiMatKetNoiMcp("chuỗi"), false);
  });
});
