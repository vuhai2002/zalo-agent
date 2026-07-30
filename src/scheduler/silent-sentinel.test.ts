import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSilentResponse } from "./silent-sentinel.js";

// Module thuần - không đụng DB/env, import tĩnh bình thường được.

describe("isSilentResponse", () => {
  it("toàn bộ câu trả lời chỉ là [SILENT] thì nuốt", () => {
    assert.equal(isSilentResponse("[SILENT]"), true);
    assert.equal(isSilentResponse("  [SILENT]  "), true, "trim khoảng trắng thừa");
    assert.equal(isSilentResponse("[silent]"), true, "không phân biệt hoa/thường");
  });

  it("[SILENT] đứng riêng ở dòng ĐẦU thì nuốt, dòng khác có nội dung vẫn được", () => {
    assert.equal(isSilentResponse("[SILENT]\n\nKhông có gì thêm."), true);
  });

  it("[SILENT] đứng riêng ở dòng CUỐI thì nuốt", () => {
    assert.equal(isSilentResponse("2 tin mới đã lọc xong, không có gì đáng báo.\n\n[SILENT]"), true);
  });

  it("mở đầu bằng [SILENT] kèm chữ trên CÙNG dòng thì nuốt", () => {
    assert.equal(isSilentResponse("[SILENT] Không có gì mới hôm nay."), true);
  });

  it("[SILENT] nằm GIỮA câu thì VẪN GỬI - không được nuốt nhầm câu trả lời thật", () => {
    assert.equal(
      isSilentResponse("Mình định [SILENT] nhưng đây là tóm tắt hôm nay: giá vàng tăng nhẹ."),
      false,
    );
  });

  it("dòng giữa có chữ [SILENT] nhưng không phải dòng đầu/cuối thì vẫn gửi", () => {
    const text = "Tiêu đề báo cáo\n[SILENT] là từ khoá nội bộ, bỏ qua\nKết luận: ổn định.";
    assert.equal(isSilentResponse(text), false);
  });

  it("câu trả lời thật bình thường (không dính token) thì gửi", () => {
    assert.equal(isSilentResponse("Hôm nay có 3 tin công nghệ đáng chú ý: ..."), false);
  });

  it("chuỗi rỗng hoặc chỉ khoảng trắng thì KHÔNG được coi là silent (để caller tự xử lý ca rỗng)", () => {
    assert.equal(isSilentResponse(""), false);
    assert.equal(isSilentResponse("   \n  "), false);
  });

  it("từ chứa 'SILENT' nhưng không đúng token (không ngoặc) thì không nuốt", () => {
    assert.equal(isSilentResponse("Silent retry đã thành công."), false);
  });
});
