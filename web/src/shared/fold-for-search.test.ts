import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldForSearch, nhanKhopTuKhoa } from "./fold-for-search";

describe("foldForSearch", () => {
  it("bỏ dấu để gõ không dấu vẫn tìm được", () => {
    assert.equal(foldForSearch("Hồ Chí Minh"), "ho chi minh");
    assert.equal(foldForSearch("Vừa"), "vua");
    assert.equal(foldForSearch("  CAO  "), "cao");
  });

  it("đ/Đ phải thành d - NFD KHÔNG tách được chữ này", () => {
    // Cùng cái bẫy đã ghi ở slugify-vietnamese.ts. Sai chỗ này thì gõ "dong"
    // không ra "Đồng", mà đó là chữ rất hay gặp.
    assert.equal(foldForSearch("Đồng"), "dong");
    assert.equal(foldForSearch("đường"), "duong");
    assert.ok(!foldForSearch("Đà Nẵng").includes("đ"));
  });

  it("chuỗi không dấu giữ nguyên (chỉ hạ chữ thường)", () => {
    assert.equal(foldForSearch("Asia/Ho_Chi_Minh (GMT+07:00)"), "asia/ho_chi_minh (gmt+07:00)");
  });
});

describe("nhanKhopTuKhoa", () => {
  it("từ khóa rỗng thì khớp tất - danh sách không bị trống lúc mới mở", () => {
    assert.ok(nhanKhopTuKhoa("Asia/Ho_Chi_Minh (GMT+07:00)", ""));
    assert.ok(nhanKhopTuKhoa("Asia/Ho_Chi_Minh (GMT+07:00)", "   "));
  });

  it("khớp một phần, không phân biệt hoa thường", () => {
    assert.ok(nhanKhopTuKhoa("Asia/Ho_Chi_Minh (GMT+07:00)", "HO_CHI"));
    assert.ok(nhanKhopTuKhoa("Europe/London (GMT+01:00)", "london"));
    assert.ok(!nhanKhopTuKhoa("Europe/London (GMT+01:00)", "tokyo"));
  });

  it("nhiều tiếng KHÔNG cần liền nhau, cũng không cần đúng thứ tự", () => {
    // Người dùng nhớ "minh" và "asia" nhưng không nhớ chuỗi đầy đủ
    assert.ok(nhanKhopTuKhoa("Asia/Ho_Chi_Minh (GMT+07:00)", "minh asia"));
    assert.ok(nhanKhopTuKhoa("Asia/Ho_Chi_Minh (GMT+07:00)", "asia minh"));
    // nhưng thiếu một tiếng thì không khớp - nếu không, gõ càng nhiều càng loãng
    assert.ok(!nhanKhopTuKhoa("Asia/Ho_Chi_Minh (GMT+07:00)", "asia tokyo"));
  });

  it("tìm được múi giờ bằng phần offset", () => {
    assert.ok(nhanKhopTuKhoa("Asia/Ho_Chi_Minh (GMT+07:00)", "+07"));
  });

  it("gõ không dấu ra được nhãn CÓ dấu - lý do tồn tại của cả file này", () => {
    assert.ok(nhanKhopTuKhoa("Vừa", "vua"));
    assert.ok(nhanKhopTuKhoa("Cao nhất", "cao nhat"));
    assert.ok(nhanKhopTuKhoa("Đang bật", "dang bat"));
  });
});
