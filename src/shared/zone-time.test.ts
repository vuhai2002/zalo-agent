import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayKeyOf, deferredRunAtUtc, startOfDayUtc, todayKey, zonedWallClockToUtc } from "./zone-time.js";

// Module thuần, không cần setupTestEnv. Mọi mốc đặt tường minh - không dựa vào
// giờ máy chạy test, đúng bài học "test xanh vô nghĩa" đã dính ở read-zip-entry.

describe("zonedWallClockToUtc", () => {
  it("giờ tường VN -> UTC đúng offset +7, không phụ thuộc TZ tiến trình", () => {
    // Đặt TZ tiến trình khác nhau TRƯỚC mỗi lần gọi: hàm luôn nhận zone tường
    // minh nên hai TZ máy chủ khác nhau phải ra CÙNG một kết quả. Nếu ai đó lỡ
    // sửa hàm về new Date(...) không kèm zone, test này sẽ đỏ ngay.
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const underUtc = zonedWallClockToUtc("2026-08-01", "15:00", "Asia/Ho_Chi_Minh");
      process.env.TZ = "America/New_York";
      const underNy = zonedWallClockToUtc("2026-08-01", "15:00", "Asia/Ho_Chi_Minh");

      assert.equal(underUtc, "2026-08-01T08:00:00.000Z");
      assert.equal(underNy, "2026-08-01T08:00:00.000Z");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("zone có DST (Europe/Paris) hai bên mốc chuyển giờ xuân 2026-03-29: offset đổi theo, không phải hằng số", () => {
    // Đo thật bằng luxon trước khi chốt số: Paris chuyển CET(+1) -> CEST(+2)
    // đúng 2026-03-29. 28/03 vẫn +1, 30/03 đã +2 - đây là thứ phép tự-cộng-7-
    // tiếng (hay tự-cộng-offset-cứng bất kỳ) sẽ luôn trượt một bên.
    assert.equal(zonedWallClockToUtc("2026-03-28", "12:00", "Europe/Paris"), "2026-03-28T11:00:00.000Z");
    assert.equal(zonedWallClockToUtc("2026-03-30", "12:00", "Europe/Paris"), "2026-03-30T10:00:00.000Z");
  });

  it("ngày/giờ không tồn tại trên lịch -> null, không ném lỗi", () => {
    assert.equal(zonedWallClockToUtc("2026-13-40", "15:00", "Asia/Ho_Chi_Minh"), null, "tháng 13 không tồn tại");
    assert.equal(zonedWallClockToUtc("2026-02-30", "15:00", "Asia/Ho_Chi_Minh"), null, "30/02 không tồn tại");
    assert.equal(zonedWallClockToUtc("2026-08-01", "25:99", "Asia/Ho_Chi_Minh"), null, "25:99 không phải giờ hợp lệ");
    assert.equal(zonedWallClockToUtc("khong-phai-ngay", "15:00", "Asia/Ho_Chi_Minh"), null, "chuỗi rác");
    assert.equal(zonedWallClockToUtc("", "", "Asia/Ho_Chi_Minh"), null, "chuỗi rỗng");
  });

  it("timezone hỏng rơi về UTC thay vì throw - không được chết lượt agent/scheduler", () => {
    assert.equal(zonedWallClockToUtc("2026-08-01", "15:00", "Khong/Ton_Tai"), "2026-08-01T15:00:00.000Z");
    assert.equal(zonedWallClockToUtc("2026-08-01", "15:00", ""), "2026-08-01T15:00:00.000Z");
  });
});

describe("startOfDayUtc", () => {
  it("03:00 sáng giờ VN ngày 31/07 vẫn thuộc mốc đầu ngày 31/07 (VN), KHÔNG phải 00:00Z", () => {
    // 20:00Z 30/07 = 03:00 31/07 giờ VN. Đầu ngày VN của 31/07 là 00:00 VN
    // 31/07 = 17:00Z 30/07 hôm trước. Bug cũ (strftime UTC) sẽ ra
    // 2026-07-31T00:00:00Z - đúng con số phải KHÔNG được trả.
    const now = new Date("2026-07-30T20:00:00Z");
    const start = startOfDayUtc("Asia/Ho_Chi_Minh", now);
    assert.equal(start, "2026-07-30T17:00:00.000Z");
    assert.notEqual(start, "2026-07-31T00:00:00Z");
  });

  it("timezone hỏng rơi về UTC: đầu ngày tính thẳng theo lịch UTC", () => {
    const now = new Date("2026-07-30T20:00:00Z");
    assert.equal(startOfDayUtc("Khong/Ton_Tai", now), "2026-07-30T00:00:00.000Z");
  });

  it("không truyền now thì lấy giờ hệ thống hiện tại (chỉ kiểm không throw + đúng dạng ISO)", () => {
    // Giờ:phút UTC của mốc đầu ngày phụ thuộc offset zone (VN +7 nên KHÔNG
    // phải 00:00Z) - chỉ kiểm giây/mili giây luôn tròn 0, đúng bất biến của
    // "đầu ngày" bất kể zone nào, không gắn cứng vào giờ máy chạy test.
    const start = startOfDayUtc("Asia/Ho_Chi_Minh");
    assert.match(start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  });
});

describe("dayKeyOf", () => {
  it("gom theo ngày VN, không phải ngày UTC - đúng lỗi getDailyUsage/overview-stats đang vá", () => {
    // 20:00Z 30/07 = 03:00 31/07 giờ VN -> phải thuộc ngày VN 31/07, dù ngày
    // UTC của chính mốc đó vẫn là 30/07. substr(created_at, 1, 10) kiểu cũ sẽ
    // luôn trả '2026-07-30', đúng con số bug này thay thế.
    assert.equal(dayKeyOf("2026-07-30T20:00:00.000Z", "Asia/Ho_Chi_Minh"), "2026-07-31");
    assert.equal(dayKeyOf("2026-07-30T20:00:00.000Z", "UTC"), "2026-07-30");
  });

  it("đúng ranh giới nửa đêm VN (17:00Z là mốc đổi ngày)", () => {
    assert.equal(dayKeyOf("2026-07-30T16:59:59.999Z", "Asia/Ho_Chi_Minh"), "2026-07-30");
    assert.equal(dayKeyOf("2026-07-30T17:00:00.000Z", "Asia/Ho_Chi_Minh"), "2026-07-31");
  });

  it("timezone hỏng rơi về UTC thay vì throw", () => {
    assert.equal(dayKeyOf("2026-07-30T20:00:00.000Z", "Khong/Ton_Tai"), "2026-07-30");
  });

  it("mốc UTC không hợp lệ ném lỗi rõ ràng - utcIso luôn do hệ thống sinh, hỏng là lỗi lập trình", () => {
    assert.throws(() => dayKeyOf("khong-phai-iso", "Asia/Ho_Chi_Minh"));
  });
});

describe("deferredRunAtUtc", () => {
  it("đúng giờ cấu hình của NGÀY MAI, KHÔNG PHẢI 00:00 - mốc trưa giờ VN", () => {
    // 10:00 sáng giờ VN 01/08 -> đẩy sang 8h sáng giờ VN NGÀY MAI 02/08 = 01:00Z 02/08
    const now = new Date("2026-08-01T03:00:00.000Z");
    assert.equal(deferredRunAtUtc("Asia/Ho_Chi_Minh", 8, now), "2026-08-02T01:00:00.000Z");
  });

  it("LUÔN là ngày mai dù `now` đã qua giờ cấu hình của HÔM NAY hay chưa - không phải 'lần kế tiếp của giờ đó'", () => {
    // 23:50 giờ VN 01/08 (đã qua xa giờ 8h sáng CỦA HÔM NAY) - vẫn phải đẩy
    // sang 8h sáng giờ VN NGÀY MAI 02/08, không phải "8h sáng gần nhất" mà có
    // thể hiểu nhầm là VẪN CÒN HÔM NAY nếu tính sai kiểu "giờ kế tiếp".
    const lucKhuya = new Date("2026-08-01T16:50:00.000Z"); // 23:50 giờ VN 01/08
    assert.equal(deferredRunAtUtc("Asia/Ho_Chi_Minh", 8, lucKhuya), "2026-08-02T01:00:00.000Z");

    // Ngay cả khi `now` mới là 01:00 sáng giờ VN (TRƯỚC giờ 8h của CHÍNH hôm
    // nay) - vẫn phải nhảy sang ngày mai, không phải "8h sáng nay còn kịp".
    const lucSomSang = new Date("2026-08-01T18:00:00.000Z"); // 01:00 giờ VN 02/08
    assert.equal(deferredRunAtUtc("Asia/Ho_Chi_Minh", 8, lucSomSang), "2026-08-03T01:00:00.000Z");
  });

  it("khác giờ cấu hình cho ra khác mốc - tham số hour có tác dụng thật, không hard-code 8", () => {
    const now = new Date("2026-08-01T03:00:00.000Z");
    assert.equal(deferredRunAtUtc("Asia/Ho_Chi_Minh", 0, now), "2026-08-01T17:00:00.000Z", "0h = đúng nửa đêm giờ VN");
    assert.equal(deferredRunAtUtc("Asia/Ho_Chi_Minh", 23, now), "2026-08-02T16:00:00.000Z");
  });

  it("timezone hỏng rơi về UTC thay vì throw", () => {
    const now = new Date("2026-08-01T03:00:00.000Z");
    assert.equal(deferredRunAtUtc("Khong/Ton_Tai", 8, now), "2026-08-02T08:00:00.000Z");
  });

  it("zone có DST (Europe/Paris) vẫn cộng ĐÚNG 1 NGÀY LỊCH qua mốc chuyển giờ, không phải cộng cứng 24 tiếng", () => {
    // 28/03/2026 12:00 Paris (CET, +1) -> ngày mai 29/03 (CEST, +2, đúng ngày
    // chuyển giờ mùa xuân) lúc 8h sáng = 06:00Z, KHÔNG PHẢI 07:00Z (nếu cộng
    // cứng 24h từ mốc UTC gốc sẽ lệch 1 tiếng do offset đổi giữa chừng).
    const now = new Date("2026-03-28T11:00:00.000Z"); // 12:00 Paris (CET +1)
    assert.equal(deferredRunAtUtc("Europe/Paris", 8, now), "2026-03-29T06:00:00.000Z");
  });
});

describe("todayKey", () => {
  it("tương đương dayKeyOf(now.toISOString(), tz) - chỉ là tiện dùng thẳng", () => {
    const now = new Date("2026-07-30T20:00:00Z");
    assert.equal(todayKey("Asia/Ho_Chi_Minh", now), "2026-07-31");
    assert.equal(todayKey("UTC", now), "2026-07-30");
  });

  it("không truyền now thì lấy giờ hệ thống hiện tại (chỉ kiểm đúng dạng khóa ngày)", () => {
    assert.match(todayKey("Asia/Ho_Chi_Minh"), /^\d{4}-\d{2}-\d{2}$/);
  });
});
