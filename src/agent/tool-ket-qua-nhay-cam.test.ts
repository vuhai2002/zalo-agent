import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeStep } from "./agent-step-trace.js";
import { anKetQuaNhayCam } from "./tool-ket-qua-nhay-cam.js";
import { ketQuaLoi, laKetQuaLoi } from "./tools/tool-failure-result.js";

const SAO_KE = "Chủ TK: Nguyễn Văn A - STK 0531000568888 - số dư 120.000.000";

describe("ẩn kết quả tool đọc tệp khỏi log và trace", () => {
  it("doc_file: thay bằng dòng mô tả độ dài, không còn chữ của tệp", () => {
    const ra = String(anKetQuaNhayCam("doc_file", SAO_KE));
    assert.doesNotMatch(ra, /0531000568888/);
    assert.match(ra, /không ghi log/);
    assert.match(ra, new RegExp(`${SAO_KE.length} ký tự`));
  });

  it("doc_file hỏng: giữ nguyên dấu hiệu hỏng (câu lỗi do máy chủ viết, không chứa chữ của tệp)", () => {
    const loi = ketQuaLoi("Tệp có mật khẩu");
    assert.equal(laKetQuaLoi(anKetQuaNhayCam("doc_file", loi)), true);
  });

  it("tool khác giữ nguyên", () => {
    assert.equal(anKetQuaNhayCam("web_fetch", "trang web"), "trang web");
  });

  it("summarizeStep (trace + log debug) không chứa chữ của tệp", () => {
    const t = summarizeStep({ stepNumber: 0, toolResults: [{ toolName: "doc_file", output: SAO_KE }] } as never, 500);
    assert.doesNotMatch(JSON.stringify(t), /0531000568888/);
  });
});
