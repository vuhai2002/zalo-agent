import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelMessage } from "ai";
import { catNguCanhTheoNganSach } from "./trim-context-to-budget.js";
import { uocLuongTokenTinNhan } from "./token-estimate.js";

/**
 * Hàm thuần nên test không cần setupTestEnv, không cần import động - đây là
 * ngoại lệ hợp lệ của bẫy "database.ts chạy migration ở module scope".
 */

const chu = (n: number) => "a".repeat(n);

const tinChu = (n: number): ModelMessage => ({ role: "user", content: chu(n) });

const tinCoAnh = (soAnh: number, chuDai = 20): ModelMessage => ({
  role: "user",
  content: [
    ...Array.from({ length: soAnh }, () => ({
      type: "file" as const,
      data: "base64...",
      mediaType: "image/jpeg",
    })),
    { type: "text" as const, text: chu(chuDai) },
  ],
});

describe("catNguCanhTheoNganSach", () => {
  it("dưới ngân sách thì KHÔNG đụng gì - trả đúng mảng cũ", () => {
    const ds = [tinChu(100), tinChu(100), tinChu(100)];
    const r = catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 100_000, soTinBaoVeCuoi: 1 });
    assert.equal(r.daCat, null, "không cắt gì thì daCat phải là null");
    assert.equal(r.tinNhan, ds, "phải trả về CHÍNH mảng cũ, không sao chép thừa");
  });

  it("trần <= 0 coi như tắt tính năng, không cắt", () => {
    const ds = [tinChu(100_000), tinChu(100_000)];
    assert.equal(catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 0, soTinBaoVeCuoi: 1 }).daCat, null);
  });

  it("vượt vì ẢNH thì bỏ ảnh TRƯỚC, không bỏ tin", () => {
    // 3 ảnh = 2400 token, chữ không đáng kể
    const ds = [tinCoAnh(3), tinChu(50), tinChu(50)];
    const r = catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 200, soTinBaoVeCuoi: 1 });
    assert.ok(r.daCat, "phải có cắt");
    assert.equal(r.daCat!.soAnhBo, 3, "phải bỏ đủ 3 ảnh");
    assert.equal(r.daCat!.soTinBo, 0, "không được bỏ tin nào khi bỏ ảnh đã đủ");
    assert.equal(r.tinNhan.length, 3, "vẫn còn đủ 3 tin");
  });

  it("bỏ ảnh vẫn giữ nguyên phần CHỮ của tin đó", () => {
    const ds = [tinCoAnh(2, 40), tinChu(10)];
    const r = catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 100, soTinBaoVeCuoi: 1 });
    const dau = r.tinNhan[0]!;
    const text = typeof dau.content === "string" ? dau.content : JSON.stringify(dau.content);
    assert.match(text, /a{40}/, "phần chữ của tin có ảnh phải còn nguyên");
  });

  it("vượt vì CHỮ thì bỏ tin cũ nhất, giữ tin mới", () => {
    const ds = [tinChu(5000), tinChu(5000), tinChu(100)];
    const r = catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 500, soTinBaoVeCuoi: 1 });
    assert.ok(r.daCat!.soTinBo > 0, "phải bỏ tin");
    // Tin cuối (lượt hiện tại) phải là tin còn lại
    assert.equal(r.tinNhan.at(-1)!.content, chu(100));
  });

  it("TUYỆT ĐỐI không cắt tin của lượt hiện tại, kể cả khi cắt hết vẫn vượt", () => {
    // Tin cuối một mình đã vượt trần
    const ds = [tinChu(5000), tinChu(5000), tinChu(9000)];
    const r = catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 100, soTinBaoVeCuoi: 1 });
    assert.equal(r.tinNhan.length, 1, "chỉ còn đúng vùng được bảo vệ");
    assert.equal(r.tinNhan[0]!.content, chu(9000), "và đó phải là tin của lượt hiện tại");
    assert.ok(uocLuongTokenTinNhan(r.tinNhan) > 100, "vẫn vượt - đúng, thà tràn còn hơn gửi rỗng");
  });

  it("bảo vệ nhiều tin cuối (batch ảnh + caption Zalo gửi tách tin)", () => {
    const ds = [tinChu(9000), tinChu(9000), tinChu(30), tinChu(30), tinChu(30)];
    const r = catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 100, soTinBaoVeCuoi: 3 });
    assert.equal(r.tinNhan.length, 3, "3 tin cuối đều phải sống sót");
  });

  it("không bao giờ trả mảng rỗng", () => {
    const ds = [tinChu(9000), tinChu(9000)];
    const r = catNguCanhTheoNganSach({ tinNhan: ds, tranToken: 1, soTinBaoVeCuoi: 1 });
    assert.ok(r.tinNhan.length >= 1, "phải còn ít nhất tin của lượt hiện tại");
  });

  it("tin có ảnh mà bỏ hết ảnh cũng không thành content rỗng", () => {
    // Tin chỉ có ảnh, không có chữ
    const chiAnh: ModelMessage = {
      role: "user",
      content: [{ type: "file", data: "x", mediaType: "image/jpeg" }],
    };
    const r = catNguCanhTheoNganSach({
      tinNhan: [chiAnh, tinChu(10)],
      tranToken: 50,
      soTinBaoVeCuoi: 1,
    });
    const dau = r.tinNhan[0]!;
    assert.ok(
      typeof dau.content === "string" ? dau.content.length > 0 : dau.content.length > 0,
      "content rỗng bị provider từ chối",
    );
  });

  it("không cắt GIỮA một tin - khối <noi_dung_ngoai> phải nguyên vẹn hoặc mất hẳn", () => {
    const coKhoi: ModelMessage = {
      role: "user",
      content: `<noi_dung_ngoai nguon="x">${chu(8000)}</noi_dung_ngoai>`,
    };
    const r = catNguCanhTheoNganSach({
      tinNhan: [coKhoi, tinChu(20)],
      tranToken: 100,
      soTinBaoVeCuoi: 1,
    });
    for (const t of r.tinNhan) {
      const s = typeof t.content === "string" ? t.content : JSON.stringify(t.content);
      const mo = (s.match(/<noi_dung_ngoai/g) ?? []).length;
      const dong = (s.match(/<\/noi_dung_ngoai>/g) ?? []).length;
      assert.equal(mo, dong, "số thẻ mở phải bằng số thẻ đóng - không được cắt hở khối");
    }
  });
});
