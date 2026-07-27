import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHourlyRateLimit } from "./hourly-rate-limit.js";

const HOUR = 60 * 60 * 1000;

function make(limit: number) {
  return createHourlyRateLimit({
    limit: () => limit,
    buildReason: ({ used, limit: max, waitMinutes }) => `dùng ${used}/${max}, chờ ${waitMinutes} phút`,
  });
}

describe("createHourlyRateLimit", () => {
  it("cho tới đúng trần rồi mới chặn", () => {
    const rl = make(3);
    for (let i = 1; i <= 3; i++) assert.equal(rl.check("t1").ok, true, `lần ${i}`);
    assert.equal(rl.check("t1").ok, false);
  });

  it("đếm riêng từng key", () => {
    const rl = make(2);
    rl.check("t1");
    rl.check("t1");
    assert.equal(rl.check("t1").ok, false);
    assert.equal(rl.check("t2").ok, true);
  });

  it("cửa sổ TRƯỢT: lần cũ rơi khỏi 1 giờ là có thêm suất, không phải chờ hết cả giờ", () => {
    const rl = make(3);
    const t0 = Date.now();
    rl.check("t1", t0);
    rl.check("t1", t0 + 30 * 60_000);
    rl.check("t1", t0 + 40 * 60_000);
    assert.equal(rl.check("t1", t0 + 50 * 60_000).ok, false);
    assert.equal(rl.check("t1", t0 + HOUR + 1000).ok, true);
  });

  it("buildReason nhận đúng số đã dùng, trần và số phút phải chờ", () => {
    const rl = make(3);
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) rl.check("t1", t0);
    const blocked = rl.check("t1", t0 + 20 * 60_000);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.ok === false ? blocked.reason : "", "dùng 3/3, chờ 40 phút");
  });

  it("số phút chờ tối thiểu là 1 - không bao giờ nói 'chờ 0 phút'", () => {
    const rl = make(1);
    const t0 = Date.now();
    rl.check("t1", t0);
    // Sát mép cửa sổ: còn chưa tới 1 phút
    const blocked = rl.check("t1", t0 + HOUR - 1000);
    assert.match(blocked.ok === false ? blocked.reason : "", /chờ 1 phút/);
  });

  it("key nguội bị dọn khỏi bộ nhớ (hồi quy rò rỉ Map ở V2.4)", () => {
    const rl = make(3);
    const t0 = Date.now();
    for (let i = 0; i < 500; i++) rl.check(`cu-${i}`, t0);
    rl.check("moi", t0 + HOUR + 1000);
    for (let i = 1; i <= 3; i++) {
      assert.equal(rl.check("cu-0", t0 + HOUR + 2000).ok, true, `suất ${i} sau khi dọn`);
    }
  });

  it("trần đọc lúc GỌI chứ không phải lúc tạo - env đổi là ăn ngay", () => {
    let max = 1;
    const rl = createHourlyRateLimit({ limit: () => max, buildReason: () => "hết" });
    assert.equal(rl.check("t1").ok, true);
    assert.equal(rl.check("t1").ok, false);
    max = 5;
    assert.equal(rl.check("t1").ok, true, "nới trần thì lần tiếp theo đi lọt");
  });

  it("reset xóa sạch trạng thái đếm", () => {
    const rl = make(1);
    rl.check("t1");
    assert.equal(rl.check("t1").ok, false);
    rl.reset();
    assert.equal(rl.check("t1").ok, true);
  });

  it("hai bộ đếm độc lập nhau - tool này đầy không chặn tool kia", () => {
    const a = make(1);
    const b = make(1);
    a.check("t1");
    assert.equal(a.check("t1").ok, false);
    assert.equal(b.check("t1").ok, true);
  });
});
