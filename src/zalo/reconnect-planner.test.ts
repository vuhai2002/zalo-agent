import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KeHoachKetNoiLai } from "./reconnect-planner.js";

/**
 * Planner THUẦN - không đụng DB/env nên import tĩnh được. Đây là lưới đỡ cho ca
 * thật 2026-08-25 (đổi mật khẩu -> phiên chết -> bão reconnect vô tận).
 */

// Opts nhỏ, dễ đọc số: nối >= 100ms là đứng; backoff 10 -> 20 -> 40...; trần 100; nghi sau 3 lần.
const OPTS = { onDinhMs: 100, coSoMs: 10, tranMs: 100, nguongNghiNgo: 3 };

describe("KeHoachKetNoiLai", () => {
  it("kết nối ĐỨNG (>= onDinhMs) rồi đóng -> reset: backoff về cơ số, không nghi phiên chết", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    k.danhDauKetNoi(0);
    const r = k.danhDauDong(200, 0); // nối 200ms >= 100 -> đứng
    assert.equal(r.onDinh, true);
    assert.equal(r.delayMs, 10, "đứng -> soLan reset 0 -> backoff = cơ số");
    assert.equal(r.chopTatLienTiep, 0);
    assert.equal(r.nghiNgoPhienChet, false);
  });

  it("nối đúng BẰNG onDinhMs vẫn tính là đứng (>=)", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    k.danhDauKetNoi(0);
    assert.equal(k.danhDauDong(100, 0).onDinh, true);
  });

  it("chớp-tắt liên tiếp -> backoff TĂNG gấp đôi mỗi lần", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    // Không danhDauKetNoi -> mỗi lần đóng đều là chớp-tắt
    assert.equal(k.danhDauDong(1, 0).delayMs, 10); // 10 * 2^0
    assert.equal(k.danhDauDong(2, 0).delayMs, 20); // 10 * 2^1
    assert.equal(k.danhDauDong(3, 0).delayMs, 40); // 10 * 2^2
  });

  it("backoff bị CHẶN ở trần", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    const ds = [1, 2, 3, 4, 5, 6].map((t) => k.danhDauDong(t, 0).delayMs);
    // 10, 20, 40, 80, rồi 160/320 bị chặn về trần 100
    assert.deepEqual(ds, [10, 20, 40, 80, 100, 100]);
  });

  it("đủ ngưỡng chớp-tắt LIÊN TIẾP -> nghiNgoPhienChet, trước đó thì chưa", () => {
    const k = new KeHoachKetNoiLai(OPTS); // ngưỡng 3
    assert.equal(k.danhDauDong(1, 0).nghiNgoPhienChet, false); // 1
    assert.equal(k.danhDauDong(2, 0).nghiNgoPhienChet, false); // 2
    const r3 = k.danhDauDong(3, 0);
    assert.equal(r3.chopTatLienTiep, 3);
    assert.equal(r3.nghiNgoPhienChet, true); // >= 3
  });

  it("một lần kết-nối-ĐỨNG xen giữa -> RESET cả chuỗi chớp-tắt lẫn backoff", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    k.danhDauDong(1, 0); // chớp 1, soLan->1
    k.danhDauDong(2, 0); // chớp 2, soLan->2
    // kết nối đứng rồi rớt
    k.danhDauKetNoi(1000);
    const rOn = k.danhDauDong(1200, 0);
    assert.equal(rOn.onDinh, true);
    assert.equal(rOn.chopTatLienTiep, 0, "đứng phải quên chuỗi chớp-tắt");
    assert.equal(rOn.delayMs, 10, "soLan reset -> backoff cơ số");
    // chớp-tắt tiếp -> chuỗi đếm lại từ 1; backoff leo lên 20 vì lần rớt-lành vừa
    // rồi đã tiêu rung 0 (soLan->1). Flap ngay sau khi vừa hồi phục thì giãn
    // nhanh hơn một nấc - an toàn hơn, không phải lỗi.
    const r = k.danhDauDong(1300, 0);
    assert.equal(r.chopTatLienTiep, 1);
    assert.equal(r.delayMs, 20);
  });

  it("đóng khi CHƯA từng kết nối -> tính là chớp-tắt (onDinh false)", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    assert.equal(k.danhDauDong(999_999, 0).onDinh, false);
  });

  it("hai lần đóng LIÊN TIẾP không có kết nối xen giữa -> lần 2 KHÔNG tính nhầm là đứng", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    k.danhDauKetNoi(0);
    assert.equal(k.danhDauDong(200, 0).onDinh, true); // đứng, tiêu ketNoiLuc
    // lần đóng kế tiếp mà không danhDauKetNoi lại -> phải là chớp-tắt
    assert.equal(k.danhDauDong(999_999, 0).onDinh, false, "ketNoiLuc đã tiêu, không được tính lại theo mốc cũ");
  });

  it("jitter được cộng vào delay", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    assert.equal(k.danhDauDong(1, 7).delayMs, 17); // 10 + 7
  });

  it("BÃO PHIÊN CHẾT: mỗi lần nối NGẮN (dù đã danhDauKetNoi) vẫn tính chớp-tắt -> backoff LEO + cảnh báo re-login", () => {
    // Đây là lưới đỡ CỐT LÕI cho ca 2026-08-25 và cho chính bản sửa `>= onDinhMs`.
    // Bug gốc coi MỌI kết nối (kể cả 2ms) là đứng -> reset backoff -> bão không
    // bao giờ lùi, không bao giờ cảnh báo. Sabotage bỏ phép so giờ (`onDinh =
    // ketNoiLuc !== null`) thì ca này ĐỎ ngay ở vòng đầu (onDinh true).
    const k = new KeHoachKetNoiLai(OPTS); // onDinhMs 100, coSo 10, trần 100, ngưỡng 3
    const delays: number[] = [];
    let flagAt = -1;
    for (let i = 0; i < 4; i++) {
      k.danhDauKetNoi(i * 1000); // listener báo "đã kết nối"...
      const r = k.danhDauDong(i * 1000 + 2, 0); // ...rồi rớt sau 2ms = phiên chết
      delays.push(r.delayMs);
      assert.equal(r.onDinh, false, "nối 2ms KHÔNG được tính là đứng");
      if (r.nghiNgoPhienChet && flagAt < 0) flagAt = i + 1;
    }
    assert.deepEqual(delays, [10, 20, 40, 80], "backoff phải LEO dù mỗi lần đều có danhDauKetNoi");
    assert.equal(flagAt, 3, "chạm ngưỡng nghi phiên chết ở flap thứ 3");
  });

  it("danhDauKetNoi gọi nhiều lần -> so với mốc MỚI NHẤT", () => {
    const k = new KeHoachKetNoiLai(OPTS);
    k.danhDauKetNoi(0);
    k.danhDauKetNoi(1000); // onConnected bắn lại -> mốc mới
    // đóng lúc 1050: so mốc mới (1000) là 50ms < 100 -> chớp-tắt.
    // Nếu lấy mốc cũ (0) thì 1050 >= 100 -> nhầm là đứng.
    assert.equal(k.danhDauDong(1050, 0).onDinh, false, "phải so với danhDauKetNoi mới nhất");
  });

  it("nghiNgoPhienChet GIỮ true ở các flap SAU khi đã vượt ngưỡng", () => {
    const k = new KeHoachKetNoiLai(OPTS); // ngưỡng 3
    k.danhDauDong(1, 0);
    k.danhDauDong(2, 0);
    assert.equal(k.danhDauDong(3, 0).nghiNgoPhienChet, true); // đúng ngưỡng
    assert.equal(k.danhDauDong(4, 0).nghiNgoPhienChet, true); // sau ngưỡng vẫn true
    assert.equal(k.danhDauDong(5, 0).nghiNgoPhienChet, true);
  });

  it("kết nối ĐỨNG xen giữa -> TẮT cờ nghi phiên chết đang bật", () => {
    const k = new KeHoachKetNoiLai(OPTS); // ngưỡng 3
    k.danhDauDong(1, 0);
    k.danhDauDong(2, 0);
    assert.equal(k.danhDauDong(3, 0).nghiNgoPhienChet, true); // đã bật cờ
    k.danhDauKetNoi(1000);
    const r = k.danhDauDong(1200, 0); // nối 200ms >= 100 -> đứng
    assert.equal(r.nghiNgoPhienChet, false, "đứng phải tắt cờ nghi");
    assert.equal(r.chopTatLienTiep, 0);
  });
});
