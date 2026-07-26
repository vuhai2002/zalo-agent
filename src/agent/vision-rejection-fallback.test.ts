import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APICallError } from "ai";
// Module thuần (chỉ import từ "ai") - không chạm env/DB nên import tĩnh được
import { hasImageParts, isImageRejectionError } from "./vision-rejection-fallback.js";

const apiError = (statusCode: number) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: "http://test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: "",
  });

describe("isImageRejectionError - điều kiện kích hoạt reactive fallback", () => {
  it("400/413/415/422 (từ chối nội dung) -> true", () => {
    for (const status of [400, 413, 415, 422]) {
      assert.equal(isImageRejectionError(apiError(status)), true, `HTTP ${status}`);
    }
  });

  it("401/403 (sai key), 429 (quota), 5xx (tạm thời) -> false, không retry oan", () => {
    for (const status of [401, 403, 429, 500, 503]) {
      assert.equal(isImageRejectionError(apiError(status)), false, `HTTP ${status}`);
    }
  });

  it("lỗi thường (không phải APICallError) -> false", () => {
    assert.equal(isImageRejectionError(new Error("mạng đứt")), false);
    assert.equal(isImageRejectionError(undefined), false);
  });
});

describe("hasImageParts", () => {
  it("phát hiện part ảnh trong content mảng, bỏ qua text thuần", () => {
    assert.equal(
      hasImageParts([
        { role: "user", content: "chào" },
        {
          role: "user",
          content: [
            { type: "file", data: "abc", mediaType: "image/jpeg" },
            { type: "text", text: "dò vé" },
          ],
        },
      ]),
      true,
    );
    assert.equal(
      hasImageParts([
        { role: "user", content: "chào" },
        { role: "user", content: [{ type: "text", text: "chỉ chữ" }] },
      ]),
      false,
    );
  });
});
