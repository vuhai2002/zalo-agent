import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseUrlKhiLuu, oTheoNhaCungCap, type CauHinhDaLuu } from "./provider-form-fields";

const DA_LUU: CauHinhDaLuu = {
  provider: "google",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-3.5-flash-lite",
};

describe("oTheoNhaCungCap", () => {
  it("đổi sang nhà cung cấp KHÁC thì dọn sạch cả hai ô", () => {
    // Ca người dùng báo 06/08/2026: đang lưu Google, chọn Anthropic mà ô Model
    // vẫn là gemini-3.5-flash-lite. Bấm Lưu là bot chết ở lượt kế tiếp.
    assert.deepEqual(oTheoNhaCungCap("anthropic", DA_LUU), { baseUrl: "", model: "" });
    assert.deepEqual(oTheoNhaCungCap("openai-compatible", DA_LUU), { baseUrl: "", model: "" });
  });

  it("quay VỀ nhà cung cấp đang lưu thì khôi phục nguyên giá trị đã lưu", () => {
    assert.deepEqual(oTheoNhaCungCap("google", DA_LUU), {
      baseUrl: DA_LUU.baseUrl,
      model: DA_LUU.model,
    });
  });

  it("chưa tải xong cấu hình thì vẫn dọn, không nổ", () => {
    assert.deepEqual(oTheoNhaCungCap("google", null), { baseUrl: "", model: "" });
  });
});

describe("baseUrlKhiLuu", () => {
  it("nhà cung cấp gọi thẳng hãng -> null, tức XÓA hẳn base URL đang lưu", () => {
    // undefined ở đây nghĩa là "giữ nguyên", nên URL của nhà cũ sẽ nằm lại
    // trong DB và hiện lại lúc quay về - đúng thứ người dùng thấy là lỗi
    assert.equal(baseUrlKhiLuu("google", ""), null);
    assert.equal(baseUrlKhiLuu("anthropic", ""), null);
    assert.equal(baseUrlKhiLuu("anthropic", "https://con-sot.test/v1"), null);
  });

  it("openai-compatible có nhập URL thì gửi đúng URL đó", () => {
    assert.equal(baseUrlKhiLuu("openai-compatible", "https://router.test/v1"), "https://router.test/v1");
  });

  it("openai-compatible bỏ trống vẫn là GIỮ NGUYÊN như hành vi cũ", () => {
    // Đổi chỗ này thành null là ô để trống sẽ xóa mất cấu hình đang chạy
    assert.equal(baseUrlKhiLuu("openai-compatible", ""), undefined);
  });
});
