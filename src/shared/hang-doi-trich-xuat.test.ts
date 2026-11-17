import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { doiChoDenKhi } from "./doi-cho-den-khi.js";
import { resetHangDoiTrichXuat, trangThaiHangDoiTrichXuat, xepHangTrichXuat } from "./hang-doi-trich-xuat.js";

function viecTreo() {
  let xong!: (v: string) => void;
  let hong!: (e: Error) => void;
  const p = new Promise<string>((res, rej) => {
    xong = res;
    hong = rej;
  });
  return { p, xong, hong };
}

describe("xepHangTrichXuat", () => {
  beforeEach(() => resetHangDoiTrichXuat());

  it("chạy đúng MỘT việc mỗi lúc, theo thứ tự xếp, kể cả khi việc trước hỏng", async () => {
    const batDau: number[] = [];
    const v1 = viecTreo();
    const v2 = viecTreo();
    const v3 = viecTreo();
    const p1 = xepHangTrichXuat(() => (batDau.push(1), v1.p));
    const p2 = xepHangTrichXuat(() => (batDau.push(2), v2.p));
    const p3 = xepHangTrichXuat(() => (batDau.push(3), v3.p));

    await doiChoDenKhi(() => batDau.length === 1, { moTa: "việc 1 bắt đầu" });
    assert.deepEqual(batDau, [1]);
    assert.deepEqual(trangThaiHangDoiTrichXuat(), { dangChay: 1, dangCho: 2 });

    v1.hong(new Error("hỏng"));
    await assert.rejects(p1, /hỏng/);
    await doiChoDenKhi(() => batDau.length === 2, { moTa: "việc 2 bắt đầu sau khi việc 1 hỏng" });
    assert.deepEqual(batDau, [1, 2]);

    v2.xong("b");
    assert.equal(await p2, "b");
    await doiChoDenKhi(() => batDau.length === 3, { moTa: "việc 3 bắt đầu" });
    v3.xong("c");
    assert.equal(await p3, "c");
    // `finally` của hàng đợi chạy SAU khi promise của việc đã resolve
    await doiChoDenKhi(() => trangThaiHangDoiTrichXuat().dangChay === 0, { moTa: "hàng đợi rảnh" });
    assert.deepEqual(trangThaiHangDoiTrichXuat(), { dangChay: 0, dangCho: 0 });
  });
});
