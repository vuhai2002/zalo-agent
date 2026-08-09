import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KbSourceStatus } from "../dashboard-api-client";
import { conViecDoiXuLy, nenHenLuotKe, type KetQuaTaiNguon } from "./kb-poll-guard";

describe("conViecDoiXuLy (B7 - dừng poll khi hết việc)", () => {
  it("mọi nguồn đã san_sang -> không còn việc, phải dừng poll", () => {
    assert.equal(
      conViecDoiXuLy([{ trangThai: "san_sang" }, { trangThai: "san_sang" }]),
      false,
    );
  });

  it("còn 1 nguồn cho_xu_ly giữa nhiều nguồn san_sang -> vẫn còn việc", () => {
    assert.equal(
      conViecDoiXuLy([{ trangThai: "san_sang" }, { trangThai: "cho_xu_ly" }, { trangThai: "san_sang" }]),
      true,
    );
  });

  it("còn nguồn dang_xu_ly -> vẫn còn việc", () => {
    assert.equal(conViecDoiXuLy([{ trangThai: "dang_xu_ly" }]), true);
  });

  it("nguồn hong KHÔNG tính là còn việc - chỉ tự đổi khi người vận hành bấm Xử lý lại", () => {
    assert.equal(conViecDoiXuLy([{ trangThai: "hong" }, { trangThai: "san_sang" }]), false);
  });

  it("danh sách rỗng -> không còn việc", () => {
    assert.equal(conViecDoiXuLy([]), false);
  });
});

describe("nenHenLuotKe (Important 1 - poll không được chết vì MỘT lần tải hỏng)", () => {
  const thanhCong = (items: { trangThai: KbSourceStatus }[]): KetQuaTaiNguon => ({ thanhCong: true, items });
  const that_bai: KetQuaTaiNguon = { thanhCong: false };

  it("tải THÀNH CÔNG, còn nguồn dang_xu_ly -> hẹn lượt kế", () => {
    assert.equal(nenHenLuotKe(thanhCong([{ trangThai: "dang_xu_ly" }]), null), true);
  });

  it("tải THÀNH CÔNG, mọi nguồn san_sang -> KHÔNG hẹn lượt kế (đúng bất biến B7 cũ)", () => {
    assert.equal(nenHenLuotKe(thanhCong([{ trangThai: "san_sang" }]), null), false);
  });

  // Đây CHÍNH LÀ ca Important 1: bug cũ để poll chết vĩnh viễn ở đúng tình
  // huống này - lần tải trước đã biết có nguồn dang_xu_ly, rồi một lần tải
  // KẾ TIẾP hỏng (mất mạng/502). Lỗi tạm thời không được hiểu nhầm là hết việc.
  it("tải THẤT BẠI nhưng state đã biết TRƯỚC ĐÓ còn dang_xu_ly -> VẪN hẹn lượt kế", () => {
    const sourcesDaBiet = [{ trangThai: "dang_xu_ly" as const }];
    assert.equal(nenHenLuotKe(that_bai, sourcesDaBiet), true, "lỗi mạng tạm thời không được làm poll chết");
  });

  it("tải THẤT BẠI, state đã biết TRƯỚC ĐÓ toàn san_sang -> không hẹn lượt kế", () => {
    const sourcesDaBiet = [{ trangThai: "san_sang" as const }];
    assert.equal(nenHenLuotKe(that_bai, sourcesDaBiet), false);
  });

  it("tải THẤT BẠI ngay từ lần đầu (chưa từng biết gì) -> không hẹn, không có gì để suy ra còn việc", () => {
    assert.equal(nenHenLuotKe(that_bai, null), false);
  });
});
