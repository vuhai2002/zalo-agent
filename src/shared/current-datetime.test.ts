import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentDateLine,
  getDateTimeParts,
  isValidTimezone,
} from "./current-datetime.js";

// Module thuần, không cần setupTestEnv. Mốc cố định: 2026-07-25T15:30:00Z
// = 22:30 thứ bảy 25/07/2026 giờ Việt Nam (UTC+7).
const FIXED = new Date("2026-07-25T15:30:00Z");

describe("current-datetime", () => {
  it("đổi đúng sang giờ Việt Nam, thứ tiếng Việt do server tính", () => {
    const p = getDateTimeParts("Asia/Ho_Chi_Minh", FIXED);
    assert.equal(p.date, "25/07/2026");
    assert.equal(p.time, "22:30");
    assert.equal(p.weekday, "Thứ bảy");
    assert.equal(p.timezone, "Asia/Ho_Chi_Minh");
  });

  it("qua nửa đêm theo múi giờ: UTC còn 25/07 nhưng VN đã sang 26/07", () => {
    const lateUtc = new Date("2026-07-25T18:30:00Z"); // 01:30 ngày 26 giờ VN
    const p = getDateTimeParts("Asia/Ho_Chi_Minh", lateUtc);
    assert.equal(p.date, "26/07/2026");
    assert.equal(p.weekday, "Chủ nhật");
  });

  it("timezone hỏng rơi về UTC thay vì throw - không được chết lượt agent", () => {
    const p = getDateTimeParts("Khong/Ton_Tai", FIXED);
    assert.equal(p.timezone, "UTC");
    assert.equal(p.date, "25/07/2026");
    assert.equal(p.time, "15:30");
  });

  it("dòng ngày cho system prompt: có thứ + ngày, KHÔNG có giờ (giữ prompt cache)", () => {
    const line = currentDateLine("Asia/Ho_Chi_Minh", FIXED);
    assert.match(line, /Thứ bảy/);
    assert.match(line, /25\/07\/2026/);
    assert.ok(!line.includes("22:30"), "không được chứa giờ - giờ đổi mỗi phút sẽ vỡ cache");
    assert.match(line, /get_datetime/, "phải chỉ model tới tool khi cần giờ chính xác");
  });

  it("isValidTimezone nhận IANA hợp lệ, chối tên bịa", () => {
    assert.equal(isValidTimezone("Asia/Ho_Chi_Minh"), true);
    assert.equal(isValidTimezone("UTC"), true);
    assert.equal(isValidTimezone("Khong/Ton_Tai"), false);
    assert.equal(isValidTimezone(""), false);
  });
});
