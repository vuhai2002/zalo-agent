import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tachLoiRouterDoiLotChu } from "./router-error-disguised-as-text.js";

/**
 * 9Router (`open-sse/translator/response/openai-responses.js`) đổi sự kiện lỗi
 * của Responses API thành MỘT ĐOẠN CHỮ `[Error] <thông báo>` nối vào câu trả
 * lời, kết thúc bằng `finish_reason: stop`, không có usage. Ca thật 2026-11-23:
 * OpenAI chặn lượt vì "cybersecurity risk" (lịch sử có câu nhờ hack tài khoản
 * ngân hàng) và câu lỗi tiếng Anh đi thẳng xuống Zalo, 5 tin.
 */
const LOI =
  "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request.";

describe("tachLoiRouterDoiLotChu", () => {
  it("câu trả lời + đuôi [Error], step 0 token: tách phần trước và câu lỗi", () => {
    const kq = tachLoiRouterDoiLotChu({ text: `Em không muốn hứa điều mình không làm được.[Error] ${LOI}`, outputTokens: 0 });
    assert.deepEqual(kq, { phanTruoc: "Em không muốn hứa điều mình không làm được.", loi: LOI });
  });

  it("chỉ có câu lỗi: phần trước rỗng", () => {
    assert.deepEqual(tachLoiRouterDoiLotChu({ text: `[Error] ${LOI}`, outputTokens: 0 }), { phanTruoc: "", loi: LOI });
  });

  it("có token đầu ra thì KHÔNG phải lỗi router - chữ [Error] là của model, giữ nguyên", () => {
    // Người lạ bắt model gõ "[Error] ..." thì lượt vẫn có token thật: không được
    // nhận nhầm rồi cắt mất câu trả lời
    assert.equal(tachLoiRouterDoiLotChu({ text: `Đây là log: [Error] ${LOI}`, outputTokens: 42 }), null);
  });

  it("0 token mà không có [Error]: không phải ca này (completion rỗng có nhánh riêng)", () => {
    assert.equal(tachLoiRouterDoiLotChu({ text: "", outputTokens: 0 }), null);
    assert.equal(tachLoiRouterDoiLotChu({ text: "xin chào", outputTokens: 0 }), null);
  });

  it("[Error] nằm giữa rồi còn chữ khác phía sau dòng: vẫn lấy lần cuối (router luôn nối vào CUỐI)", () => {
    const kq = tachLoiRouterDoiLotChu({ text: `A [Error] cũ\nB.[Error] ${LOI}`, outputTokens: 0 });
    assert.deepEqual(kq, { phanTruoc: "A [Error] cũ\nB.", loi: LOI });
  });

  it("đuôi [Error] rỗng (router stringify lỗi rỗng) vẫn nhận, câu lỗi rỗng", () => {
    assert.deepEqual(tachLoiRouterDoiLotChu({ text: "Xong.[Error] ", outputTokens: 0 }), { phanTruoc: "Xong.", loi: "" });
  });
});
