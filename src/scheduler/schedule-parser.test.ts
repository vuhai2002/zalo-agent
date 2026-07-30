import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSchedule, type ParseScheduleResult } from "./schedule-parser.js";

// Module thuần, không cần setupTestEnv. Mọi mốc đặt tường minh qua `now` -
// đúng bài học "test xanh vô nghĩa" đã dính ở read-zip-entry.

/** Chạy `fn` dưới 2 TZ tiến trình khác nhau, đòi cùng kết quả - đúng yêu cầu
 * của thiết kế: parser không được lệch theo giờ máy chạy nó. */
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

function ok(r: ParseScheduleResult) {
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return r as { ok: true; schedule: Extract<ParseScheduleResult, { ok: true }>["schedule"] };
}

function loi(r: ParseScheduleResult): string {
  assert.equal(r.ok, false, "kỳ vọng bị từ chối");
  return (r as { ok: false; error: string }).error;
}

const NOW = new Date("2026-07-31T00:00:00Z");

describe("parseSchedule - once", () => {
  it("date+time quy đổi đúng UTC, không phụ thuộc TZ tiến trình - test quan trọng nhất phase", () => {
    duoiHaiTz(() => {
      const r = parseSchedule(
        { kind: "once", date: "2026-08-01", time: "15:00" },
        { timeZone: "Asia/Ho_Chi_Minh", minIntervalMinutes: 5, now: NOW },
      );
      assert.deepEqual(ok(r).schedule, { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" });
    });
  });

  it("inMinutes tính từ `now` truyền vào, không dính timezone", () => {
    const r = parseSchedule(
      { kind: "once", inMinutes: 30 },
      { timeZone: "Asia/Ho_Chi_Minh", minIntervalMinutes: 5, now: NOW },
    );
    assert.deepEqual(ok(r).schedule, { kind: "once", runAtUtc: "2026-07-31T00:30:00.000Z" });
  });

  it("inMinutes <= 0 hoặc không nguyên bị từ chối", () => {
    for (const inMinutes of [0, -5, 1.5]) {
      const r = parseSchedule({ kind: "once", inMinutes }, { timeZone: "UTC", minIntervalMinutes: 5, now: NOW });
      assert.match(loi(r), /số nguyên dương/);
    }
  });

  it("ngày/giờ không hợp lệ -> lỗi tiếng Việt đọc được (không throw)", () => {
    const r = parseSchedule(
      { kind: "once", date: "2026-02-30", time: "15:00" },
      { timeZone: "Asia/Ho_Chi_Minh", minIntervalMinutes: 5, now: NOW },
    );
    assert.match(loi(r), /không hợp lệ/);
  });

  it("mốc đã ở quá khứ bị từ chối - job không tồn tại thì không có gì để bù trễ", () => {
    const r = parseSchedule(
      { kind: "once", date: "2026-07-30", time: "08:00" },
      { timeZone: "Asia/Ho_Chi_Minh", minIntervalMinutes: 5, now: NOW },
    );
    assert.match(loi(r), /quá khứ/);
  });
});

describe("parseSchedule - every", () => {
  it("every 1 phút bị từ chối kèm giải thích - đúng ca 1440 tin/ngày", () => {
    const r = parseSchedule({ kind: "every", minutes: 1 }, { timeZone: "UTC", minIntervalMinutes: 5, now: NOW });
    assert.match(loi(r), /tối thiểu mỗi 5 phút/);
  });

  it("đúng bằng ngưỡng thì được chấp nhận (biên bao gồm)", () => {
    const r = parseSchedule({ kind: "every", minutes: 5 }, { timeZone: "UTC", minIntervalMinutes: 5, now: NOW });
    assert.deepEqual(ok(r).schedule, { kind: "every", minutes: 5 });
  });

  it("số không dương hoặc không nguyên bị từ chối", () => {
    for (const minutes of [0, -10, 2.5]) {
      const r = parseSchedule({ kind: "every", minutes }, { timeZone: "UTC", minIntervalMinutes: 5, now: NOW });
      assert.match(loi(r), /số nguyên dương/);
    }
  });
});

describe("parseSchedule - cron", () => {
  it('"* * * * *" bị từ chối kèm giải thích - phải chết ở bước validate, không đợi lúc gửi', () => {
    duoiHaiTz(() => {
      const r = parseSchedule(
        { kind: "cron", expr: "* * * * *" },
        { timeZone: "Asia/Ho_Chi_Minh", minIntervalMinutes: 5, now: NOW },
      );
      assert.match(loi(r), /quá dày/);
    });
  });

  it("lịch hợp lệ được chấp nhận, giữ nguyên expr + timeZone", () => {
    const r = parseSchedule(
      { kind: "cron", expr: "0 7 * * *" },
      { timeZone: "Asia/Ho_Chi_Minh", minIntervalMinutes: 5, now: NOW },
    );
    assert.deepEqual(ok(r).schedule, { kind: "cron", expr: "0 7 * * *", timeZone: "Asia/Ho_Chi_Minh" });
  });

  it("biểu thức rác hoặc rỗng bị từ chối, không ném lỗi ra ngoài", () => {
    for (const expr of ["khong-phai-cron", "", "   ", "* * * * * * * *"]) {
      const r = parseSchedule({ kind: "cron", expr }, { timeZone: "UTC", minIntervalMinutes: 5, now: NOW });
      assert.equal(r.ok, false);
    }
  });
});
