import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeNextRun, decideDueAction, graceSecondsFor } from "./next-run.js";
import type { ParsedSchedule } from "./schedule-parser.js";

// Module thuần, không cần setupTestEnv. Mọi mốc đặt tường minh.

function duoiHaiTz(fn: () => void): void {
  const original = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    fn();
    process.env.TZ = "America/New_York";
    fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe("computeNextRun - once", () => {
  it("trả nguyên runAtUtc, không phụ thuộc from/now", () => {
    const schedule: ParsedSchedule = { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" };
    assert.equal(
      computeNextRun(schedule, new Date("2000-01-01T00:00:00Z"), new Date("2099-01-01T00:00:00Z")),
      "2026-08-01T08:00:00.000Z",
    );
  });
});

describe("computeNextRun - every (chống trôi lịch)", () => {
  it("đúng hạn (now = from): mốc kế = from + interval", () => {
    const schedule: ParsedSchedule = { kind: "every", minutes: 30 };
    const from = new Date("2026-08-01T07:00:00Z");
    assert.equal(computeNextRun(schedule, from), "2026-08-01T07:30:00.000Z");
  });

  it("lỡ 3 tiếng với every 30 phút: nhảy thẳng tới mốc tương lai gần nhất trên LƯỚI GỐC, không dồn 6 lượt", () => {
    const schedule: ParsedSchedule = { kind: "every", minutes: 30 };
    const from = new Date("2026-08-01T07:00:00Z"); // mốc LẼ RA phải chạy
    const now = new Date("2026-08-01T10:00:00Z"); // bot vừa bật lại, trễ 3 tiếng

    const next = computeNextRun(schedule, from, now);

    // Vẫn khớp lưới 30 phút neo từ `from` (07:00, 07:30, 08:00 ... 10:00, 10:30)
    assert.equal(next, "2026-08-01T10:30:00.000Z");
    // Phải ở TƯƠNG LAI so với `now` - nếu chỉ cộng ngây thơ from+interval (07:30)
    // thì mốc mới vẫn nằm trong quá khứ và tick kế sẽ lại thấy due ngay, sinh dồn
    assert.ok(new Date(next).getTime() > now.getTime());
  });

  it("now sớm hơn from (không nên xảy ra) vẫn không nhảy lùi thời gian", () => {
    const schedule: ParsedSchedule = { kind: "every", minutes: 10 };
    const from = new Date("2026-08-01T07:00:00Z");
    const now = new Date("2026-08-01T06:00:00Z");
    assert.equal(computeNextRun(schedule, from, now), "2026-08-01T07:10:00.000Z");
  });
});

describe("computeNextRun - cron (test quan trọng nhất phase này)", () => {
  it('cron "0 7 * * *" với tz=Asia/Ho_Chi_Minh ra mốc UTC 00:00, KHÔNG phải 07:00 - không phụ thuộc TZ tiến trình', () => {
    duoiHaiTz(() => {
      const schedule: ParsedSchedule = { kind: "cron", expr: "0 7 * * *", timeZone: "Asia/Ho_Chi_Minh" };
      // 2026-08-01T10:00:00Z = 17:00 giờ VN ngày 01/08 - đã qua mốc 7h sáng hôm đó
      const now = new Date("2026-08-01T10:00:00Z");
      const next = computeNextRun(schedule, now);
      assert.equal(next, "2026-08-02T00:00:00.000Z", "7h sáng VN 02/08 = 00:00 UTC 02/08");
      assert.doesNotMatch(next!, /T07:00:00/, "sai dấu hiệu: lấy nhầm giờ hệ điều hành thay vì tz truyền vào");
    });
  });

  it("biểu thức hỏng trả về null thay vì ném lỗi (phòng thủ - schedule-parser đã chặn từ trước)", () => {
    const schedule: ParsedSchedule = { kind: "cron", expr: "khong-hop-le", timeZone: "UTC" };
    assert.equal(computeNextRun(schedule, new Date()), null);
  });
});

describe("graceSecondsFor", () => {
  it("once dùng thẳng onceGraceMinutes quy đổi giây", () => {
    const schedule: ParsedSchedule = { kind: "once", runAtUtc: "2026-08-01T00:00:00.000Z" };
    assert.equal(graceSecondsFor(schedule, 10), 600);
  });

  it("every: nửa chu kỳ, kẹp trần dưới 120s khi chu kỳ quá ngắn", () => {
    const schedule: ParsedSchedule = { kind: "every", minutes: 2 }; // nửa chu kỳ = 60s
    assert.equal(graceSecondsFor(schedule, 10), 120);
  });

  it("every: nửa chu kỳ, kẹp trần trên 7200s khi chu kỳ quá dài", () => {
    const schedule: ParsedSchedule = { kind: "every", minutes: 1000 }; // nửa chu kỳ = 30000s
    assert.equal(graceSecondsFor(schedule, 10), 7200);
  });

  it("every: nửa chu kỳ nằm trong khoảng cho phép thì giữ nguyên", () => {
    const schedule: ParsedSchedule = { kind: "every", minutes: 30 }; // nửa chu kỳ = 900s
    assert.equal(graceSecondsFor(schedule, 10), 900);
  });

  it("cron: ước lượng nửa chu kỳ từ 2 mốc kế tiếp - cron ngày kẹp trần trên", () => {
    const schedule: ParsedSchedule = { kind: "cron", expr: "0 7 * * *", timeZone: "Asia/Ho_Chi_Minh" };
    // VN không có DST nên chu kỳ ngày luôn đúng 86400s -> nửa chu kỳ 43200s, kẹp 7200
    assert.equal(graceSecondsFor(schedule, 10, new Date("2026-08-01T00:00:00Z")), 7200);
  });
});

describe("decideDueAction - 4 nhánh khớp bảng thiết kế", () => {
  it("once trễ TRONG grace -> run", () => {
    const nextRunAt = new Date("2026-08-01T15:00:00Z");
    const now = new Date("2026-08-01T15:05:00Z"); // trễ 5 phút, grace 10 phút
    const schedule: ParsedSchedule = { kind: "once", runAtUtc: nextRunAt.toISOString() };
    assert.equal(decideDueAction({ schedule, nextRunAt, onceGraceMinutes: 10 }, now), "run");
  });

  it("once trễ 2 tiếng (QUÁ grace) -> run-late, không phải bị vứt", () => {
    const nextRunAt = new Date("2026-08-01T15:00:00Z");
    const now = new Date("2026-08-01T17:00:00Z"); // trễ 120 phút, grace 10 phút
    const schedule: ParsedSchedule = { kind: "once", runAtUtc: nextRunAt.toISOString() };
    assert.equal(decideDueAction({ schedule, nextRunAt, onceGraceMinutes: 10 }, now), "run-late");
  });

  it("every trễ TRONG grace -> run (chạy bù 1 lần)", () => {
    const nextRunAt = new Date("2026-08-01T07:00:00Z");
    const now = new Date("2026-08-01T07:05:00Z"); // trễ 5 phút, grace every-30m = 15 phút
    const schedule: ParsedSchedule = { kind: "every", minutes: 30 };
    assert.equal(decideDueAction({ schedule, nextRunAt, onceGraceMinutes: 10 }, now), "run");
  });

  it("every 30 phút lỡ 3 tiếng (QUÁ grace) -> skip-forward, không dồn backlog", () => {
    const nextRunAt = new Date("2026-08-01T07:00:00Z");
    const now = new Date("2026-08-01T10:00:00Z"); // trễ 180 phút, grace every-30m = 15 phút
    const schedule: ParsedSchedule = { kind: "every", minutes: 30 };
    assert.equal(decideDueAction({ schedule, nextRunAt, onceGraceMinutes: 10 }, now), "skip-forward");
  });

  it("cron lỡ nhiều ngày (QUÁ grace) -> skip-forward, cùng nhóm với every chứ không phải once", () => {
    const nextRunAt = new Date("2026-08-01T00:00:00Z"); // 7h sáng VN 01/08
    const now = new Date("2026-08-05T00:00:00Z"); // trễ 4 ngày
    const schedule: ParsedSchedule = { kind: "cron", expr: "0 7 * * *", timeZone: "Asia/Ho_Chi_Minh" };
    assert.equal(decideDueAction({ schedule, nextRunAt, onceGraceMinutes: 10 }, now), "skip-forward");
  });
});
