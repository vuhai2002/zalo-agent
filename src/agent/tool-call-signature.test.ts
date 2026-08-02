import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bamNgan, chuanHoaJson, chuKyLenhGoi } from "./tool-call-signature.js";

/**
 * Module thuần - không cần setupTestEnv, không cần import động.
 *
 * Trọng tâm của file này là BẤT BIẾN "không được ném". Hàm này chạy trong
 * `onStepFinish`, mà `notify()` của ai@7.0.37 gọi callback trong một `catch {}`
 * RỖNG: ném ở đây không đỏ lên ở đâu cả, chỉ lặng lẽ tắt guard và trace từ step
 * đó về sau. Nên mọi ca dưới đây kiểm bằng `doesNotThrow`, không phải bằng mắt.
 */

describe("chuanHoaJson - không được ném với đầu vào lạ", () => {
  it("bigint: JSON.stringify ném TypeError thẳng, phải tự xử", () => {
    assert.doesNotThrow(() => chuanHoaJson({ soLon: 10n }));
    assert.notEqual(chuanHoaJson({ n: 1n }), chuanHoaJson({ n: 2n }), "hai bigint khác phải khác chữ ký");
  });

  it("tham chiếu vòng: đệ quy không đáy sẽ tràn stack", () => {
    const a: Record<string, unknown> = { ten: "a" };
    a.chinhNo = a;
    assert.doesNotThrow(() => chuanHoaJson(a));

    const x: Record<string, unknown> = {};
    const y: Record<string, unknown> = { x };
    x.y = y;
    assert.doesNotThrow(() => chuanHoaJson(x));
  });

  it("mảng lồng vòng cũng không tràn", () => {
    const m: unknown[] = [1, 2];
    m.push(m);
    assert.doesNotThrow(() => chuanHoaJson(m));
  });

  it("hàm, symbol, undefined, NaN, Infinity", () => {
    for (const v of [() => 1, Symbol("s"), undefined, NaN, Infinity, -0]) {
      assert.doesNotThrow(() => chuanHoaJson({ v }), String(v?.toString?.() ?? v));
    }
  });
});

describe("chuanHoaJson - object KHÔNG THUẦN không được đụng chữ ký nhau", () => {
  it("hai Date khác nhau cho hai chữ ký khác nhau", () => {
    // `Object.entries(new Date())` trả về MẢNG RỖNG, nên bản đầu băm mọi Date
    // thành đúng chuỗi "{}" - hai lệnh gọi khác hẳn nhau bị coi là trùng và
    // guard chặn oan. Date đi qua `toJSON` nên giữ được mốc giờ.
    const a = new Date("2026-08-02T10:00:00Z");
    const b = new Date("2026-08-02T11:00:00Z");
    assert.notEqual(chuanHoaJson({ khi: a }), chuanHoaJson({ khi: b }));
    assert.notEqual(chuKyLenhGoi("t", { khi: a }), chuKyLenhGoi("t", { khi: b }));
  });

  it("cùng một mốc thời gian thì vẫn ra cùng chữ ký", () => {
    assert.equal(
      chuanHoaJson({ khi: new Date("2026-08-02T10:00:00Z") }),
      chuanHoaJson({ khi: new Date("2026-08-02T10:00:00Z") }),
    );
  });

  it("Date KHÔNG bị lẫn với object rỗng", () => {
    assert.notEqual(chuanHoaJson(new Date("2026-08-02T10:00:00Z")), chuanHoaJson({}));
  });

  it("Map/Set không ném (dù không phân biệt được nội dung)", () => {
    assert.doesNotThrow(() => chuanHoaJson({ m: new Map([["a", 1]]), s: new Set([1]) }));
  });

  it("object tạo bằng Object.create(null) vẫn đọc được khóa", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 2;
    o.a = 1;
    assert.equal(chuanHoaJson(o), '{"a":1,"b":2}');
  });
});

describe("chuanHoaJson - hành vi chuẩn hóa vẫn giữ nguyên", () => {
  it("sắp khóa ở mọi cấp", () => {
    assert.equal(chuanHoaJson({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
  });

  it("mảng giữ nguyên THỨ TỰ - [1,2] khác [2,1]", () => {
    assert.notEqual(chuanHoaJson([1, 2]), chuanHoaJson([2, 1]));
  });

  it("cùng object xuất hiện hai lần ở hai nhánh SONG SONG là hợp lệ, không phải vòng", () => {
    const dung = { a: 1 };
    assert.equal(chuanHoaJson({ x: dung, y: dung }), '{"x":{"a":1},"y":{"a":1}}');
  });
});

describe("bamNgan", () => {
  it("16 ký tự hex, ổn định giữa các lần gọi", () => {
    const h = bamNgan("abc");
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
    assert.equal(h, bamNgan("abc"));
    assert.notEqual(h, bamNgan("abd"));
  });
});
