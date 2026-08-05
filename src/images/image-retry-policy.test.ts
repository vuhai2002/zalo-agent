import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { laChuVeHutAnh, laLoiVeHutAnh, LoiVeHutAnh } from "./image-retry-policy.js";

/**
 * Trọng tâm: ranh giới giữa "gọi lại là được" và "gọi lại chỉ tốn thêm thời
 * gian". Nới rộng nhánh đúng thì bot đợi thêm 1-3 phút cho một lỗi vô phương;
 * thu hẹp thì mất chính ca đã xảy ra thật trên Zalo ngày 2026-08-05.
 */

describe("laLoiVeHutAnh - lỗi nào đáng gọi lại provider", () => {
  it("lỗi do CHÍNH MÌNH phân loại thì nhận ra, không cần dò chữ", () => {
    assert.equal(laLoiVeHutAnh(new LoiVeHutAnh("Provider không trả về ảnh (stream rỗng)")), true);
  });

  it("nhận đúng câu router đã bắn ra trên Zalo thật", () => {
    // Chép nguyên văn từ log turnId 166 - câu này là nhánh bắt tất của
    // 9router, phần "Plus/Pro required" chỉ là suy đoán của nó
    const that = new Error("Codex did not return an image. Account may not be entitled (Plus/Pro required).");
    assert.equal(laLoiVeHutAnh(that), true);
  });

  it("KHÔNG bám vào phần suy đoán về tài khoản - router đổi câu đó thì vẫn phải khớp", () => {
    assert.equal(laChuVeHutAnh("Codex did not return an image."), true);
    assert.equal(laChuVeHutAnh("upstream did not return an image after 3 attempts"), true);
  });

  it("quá hạn thì KHÔNG gọi lại - lần hai tiêu thêm trọn một trần thời gian nữa", () => {
    assert.equal(laLoiVeHutAnh(new Error("Vẽ ảnh quá lâu (hơn 600 giây) nên đã dừng")), false);
  });

  it("mất tín hiệu thì KHÔNG gọi lại - provider đang treo, gọi lại cũng treo", () => {
    assert.equal(laLoiVeHutAnh(new Error("Mất tín hiệu từ nhà cung cấp (im lặng quá 90 giây)")), false);
  });

  it("sai key / hết quota thì KHÔNG gọi lại - lần sau y hệt lần trước", () => {
    assert.equal(laLoiVeHutAnh(new Error("API key required for remote API access")), false);
    assert.equal(laLoiVeHutAnh(new Error("HTTP 429: rate limit exceeded")), false);
    assert.equal(laLoiVeHutAnh(new Error("Tool vẽ ảnh chưa cấu hình đủ base URL + model + API key")), false);
  });

  it("trang lỗi của proxy KHÔNG phải ca này - đó là hạ tầng, không phải model đổi ý", () => {
    assert.equal(laLoiVeHutAnh(new Error("Provider không trả về ảnh (Content-Type: text/html)")), false);
  });

  it("thứ không phải Error thì không nhận nhầm", () => {
    assert.equal(laLoiVeHutAnh("did not return an image"), false);
    assert.equal(laLoiVeHutAnh(null), false);
    assert.equal(laLoiVeHutAnh(undefined), false);
  });
});
