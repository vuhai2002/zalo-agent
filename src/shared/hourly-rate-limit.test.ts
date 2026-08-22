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
    assert.equal(rl.soKeyDangGiu(), 500);

    rl.check("moi", t0 + HOUR + 1000);
    assert.equal(rl.soKeyDangGiu(), 1, "500 key nguội phải bị dọn, chỉ còn key vừa dùng");

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

describe("hoanSuat - trả lại suất khi việc thất bại", () => {
  it("hoàn xong thì suất đó dùng lại được", () => {
    const rl = make(1);
    assert.equal(rl.check("t1").ok, true);
    assert.equal(rl.check("t1").ok, false, "trần 1, lần 2 phải bị chặn");

    rl.hoanSuat("t1");
    assert.equal(rl.check("t1").ok, true, "việc hỏng mà vẫn ăn suất là khóa người dùng vì thứ họ chưa nhận được");
  });

  it("hoàn N lần thì trả đúng N suất, không hơn", () => {
    const rl = make(3);
    rl.check("t1");
    rl.check("t1");
    rl.check("t1");

    rl.hoanSuat("t1");
    rl.hoanSuat("t1");
    assert.equal(rl.check("t1").ok, true, "suất 1");
    assert.equal(rl.check("t1").ok, true, "suất 2");
    assert.equal(rl.check("t1").ok, false, "hoàn 2 mà mở 3 là trần rò");
  });

  it("gọi thừa KHÔNG làm số đếm âm - trần vẫn giữ đúng", () => {
    const rl = make(2);
    // 5 lần hoàn trên một bộ đếm rỗng. Nếu số đếm tụt xuống âm thì sau đó phải
    // cho lọt nhiều hơn trần.
    for (let i = 0; i < 5; i++) rl.hoanSuat("t1");

    assert.equal(rl.check("t1").ok, true);
    assert.equal(rl.check("t1").ok, true);
    assert.equal(rl.check("t1").ok, false, "gọi hoàn thừa mà nới được trần là lỗ hổng");
  });

  it("hoàn của key này không đụng key kia", () => {
    const rl = make(1);
    rl.check("t1");
    rl.check("t2");

    rl.hoanSuat("t1");
    assert.equal(rl.check("t1").ok, true);
    assert.equal(rl.check("t2").ok, false, "hoàn nhầm key là một người mở khoá cho người khác");
  });

  it("hoàn trên key toàn mốc QUÁ HẠN thì DỌN LUÔN key khỏi bộ nhớ", () => {
    /**
     * Bản trước của ca này khẳng định "trần vẫn là 1 sau khi hoàn một mốc hết
     * hạn" - và đó là KHẲNG ĐỊNH RỖNG: bỏ hẳn bộ lọc `cutoff` trong `hoanSuat`
     * thì nó VẪN XANH, vì `check` tự lọc lại bằng cutoff của chính nó nên số
     * đếm không đổi dù `hoanSuat` có lọc hay không.
     *
     * (Tôi từng "chứng minh" ca cũ là thật, nhưng phép phá của tôi trúng nhầm
     * dòng cùng nội dung trong `check` - chuỗi đó có ở CẢ HAI hàm.)
     *
     * Thứ bộ lọc đó thật sự bảo vệ là BỘ NHỚ: không lọc thì `hoanSuat` ghi lại
     * mảng mốc đã chết vào Map và key sống mãi. Bot thường trú gặp hàng nghìn
     * thread nên đó là hồi quy có thật - đã xảy ra ở V2.4.
     */
    const rl = make(3);
    const t0 = 1_000_000;
    // PHẢI từ HAI mốc trở lên. Với một mốc thì cả hai đường đều xóa key
    // (`pop()` làm mảng rỗng dù có lọc hay không), nên ca một mốc không phân
    // biệt được gì - phép phá đã chứng minh đúng như vậy.
    rl.check("t1", t0);
    rl.check("t1", t0 + 1);
    rl.check("t1", t0 + 2);
    assert.equal(rl.soKeyDangGiu(), 1);

    rl.hoanSuat("t1", t0 + HOUR + 10);
    assert.equal(
      rl.soKeyDangGiu(),
      0,
      "không lọc thì `pop()` chỉ bỏ MỘT mốc chết, hai mốc chết còn lại ghi ngược vào Map và key sống mãi",
    );
  });

  it("hoàn KHÔNG tạo ra suất bù cho tương lai", () => {
    const rl = make(1);
    const t0 = 1_000_000;
    assert.equal(rl.check("t1", t0).ok, true);
    rl.hoanSuat("t1", t0 + HOUR + 1);

    assert.equal(rl.check("t1", t0 + HOUR + 2).ok, true);
    assert.equal(rl.check("t1", t0 + HOUR + 3).ok, false, "trần phải vẫn là 1");
  });
});
