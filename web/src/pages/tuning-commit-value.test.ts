import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { giaTriGuiDi } from "./tuning-commit-value";

describe("giaTriGuiDi", () => {
  it("chọn ĐÚNG giá trị mặc định thì xóa dòng đè, không ghi trùng", () => {
    // Đây là ca đã gây lỗi thật: tắt công tắc rồi bật lại. Ghi `true` vào DB
    // trong khi mặc định cũng `true` -> dòng đè vẫn còn -> giao diện báo "đã
    // chỉnh" mãi dù công tắc y hệt lúc đầu.
    assert.equal(giaTriGuiDi(true, true), null);
    assert.equal(giaTriGuiDi(false, false), null);
    assert.equal(giaTriGuiDi(500, 500), null);
    assert.equal(giaTriGuiDi("medium", "medium"), null);
  });

  it("chọn giá trị KHÁC mặc định thì gửi nguyên giá trị đó", () => {
    assert.equal(giaTriGuiDi(false, true), false);
    assert.equal(giaTriGuiDi(true, false), true);
    assert.equal(giaTriGuiDi(501, 500), 501);
    assert.equal(giaTriGuiDi("high", "medium"), "high");
  });

  it("giá trị falsy KHÁC mặc định vẫn phải gửi đi, không được nuốt thành null", () => {
    // `0` và `false` là giá trị hợp lệ. Viết `chon || null` hay `chon ?? null`
    // là im lặng bỏ mất lựa chọn của người dùng.
    assert.equal(giaTriGuiDi(0, 1), 0);
    assert.equal(giaTriGuiDi(false, true), false);
    assert.equal(giaTriGuiDi("", "off"), "");
  });

  it("KHÔNG so lỏng: 0 khác false, chuỗi '7' khác số 7", () => {
    // So lỏng (`==`) sẽ coi hai vế này là bằng nhau rồi xóa mất dòng đè -
    // người dùng đặt 0 mà hệ thống hiểu là "đang theo mặc định false".
    assert.equal(giaTriGuiDi(0, false as unknown as number), 0);
    assert.equal(giaTriGuiDi("7", 7 as unknown as string), "7");
    assert.equal(giaTriGuiDi(1, true as unknown as number), 1);
  });
});
