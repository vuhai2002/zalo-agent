import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slugifyVietnamese } from "./slugify-vietnamese.js";

/**
 * Bất biến sống còn: mọi chuỗi trả về phải khớp regex ID mà server đang bắt
 * (`createSchema` ở `src/server/routes/agent-routes.ts`), hoặc rỗng để UI biết
 * mà bắt người dùng tự gõ.
 */
const ID_HOP_LE = /^[a-z0-9][a-z0-9-]*$/;

describe("slugifyVietnamese", () => {
  it("bỏ dấu thanh và dấu mũ, nối bằng gạch ngang", () => {
    assert.equal(slugifyVietnamese("Tư Vấn Khóa Học"), "tu-van-khoa-hoc");
    assert.equal(slugifyVietnamese("Trợ lý mặc định"), "tro-ly-mac-dinh");
  });

  it("xử lý được chữ đ và Đ", () => {
    // Bẫy chính: đ/Đ (U+0111/U+0110) là chữ cái riêng, normalize("NFD") KHÔNG
    // tách nó ra. Không thay tường minh thì "Đặng" ra "ang" chứ không phải "dang".
    assert.equal(slugifyVietnamese("Đặng Văn A"), "dang-van-a");
    assert.equal(slugifyVietnamese("đồng đội"), "dong-doi");
    assert.equal(slugifyVietnamese("Đ"), "d");
  });

  it("giữ đủ 6 nguyên âm có dấu phụ riêng của tiếng Việt", () => {
    assert.equal(slugifyVietnamese("ăn âm ê ô ơ ư"), "an-am-e-o-o-u");
  });

  it("gộp ký tự đặc biệt và khoảng trắng thành một gạch", () => {
    assert.equal(slugifyVietnamese("Bot   ---   Bán   Hàng!!!"), "bot-ban-hang");
    assert.equal(slugifyVietnamese("a@#$%b"), "a-b");
  });

  it("không để lại gạch thừa ở hai đầu", () => {
    assert.equal(slugifyVietnamese("  --- Xin chào ---  "), "xin-chao");
    assert.equal(slugifyVietnamese("!!!abc"), "abc");
  });

  it("chuỗi rỗng hoặc toàn ký tự lạ trả về rỗng để UI bắt người dùng tự gõ", () => {
    assert.equal(slugifyVietnamese(""), "");
    assert.equal(slugifyVietnamese("   "), "");
    assert.equal(slugifyVietnamese("!!!"), "");
    assert.equal(slugifyVietnamese("日本語"), "");
  });

  it("cắt độ dài mà không để lại đuôi gạch", () => {
    const dai = slugifyVietnamese("a".repeat(80));
    assert.equal(dai.length, 60);
    // Tên dài với khoảng trắng rơi đúng chỗ cắt: không được ra đuôi "-"
    const catGiuaKhoangTrang = slugifyVietnamese(`${"a".repeat(59)} bcdef`);
    assert.ok(!catGiuaKhoangTrang.endsWith("-"), `không được có đuôi gạch: ${catGiuaKhoangTrang}`);
  });

  it("mọi kết quả không rỗng đều là ID server chấp nhận", () => {
    const mau = [
      "Tư Vấn Khóa Học",
      "Đặng Văn A",
      "!!!abc",
      "  --- Xin chào ---  ",
      "123 Bot",
      "a".repeat(80),
      `${"a".repeat(59)} bcdef`,
      "Bot   ---   Bán   Hàng!!!",
    ];
    for (const ten of mau) {
      const id = slugifyVietnamese(ten);
      assert.ok(ID_HOP_LE.test(id), `"${ten}" -> "${id}" không khớp ${ID_HOP_LE}`);
    }
  });
});
