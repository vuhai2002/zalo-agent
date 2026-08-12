import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doiChoDenKhi, doiChoSoLuong } from "./doi-cho-den-khi.js";

const ngu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("doiChoDenKhi", () => {
  it("điều kiện đã đúng sẵn thì trả về NGAY, không tốn một nhịp nào", async () => {
    const batDau = Date.now();
    await doiChoDenKhi(() => true, { nhipMs: 200 });
    // Nhịp 200ms mà mất chưa tới 200ms nghĩa là nó đã thử TRƯỚC khi ngủ lần đầu.
    assert.ok(Date.now() - batDau < 150, `phải về ngay, thực tế ${Date.now() - batDau}ms`);
  });

  it("chờ tới khi điều kiện đúng rồi mới về", async () => {
    let xong = false;
    setTimeout(() => (xong = true), 60);
    await doiChoDenKhi(() => xong, { moTa: "cờ xong" });
    assert.equal(xong, true);
  });

  it("về NGAY khi điều kiện đúng chứ không ngủ trọn trần - đây là lý do nó nhanh hơn sleep cố định", async () => {
    let xong = false;
    setTimeout(() => (xong = true), 40);
    const batDau = Date.now();
    await doiChoDenKhi(() => xong, { tranMs: 5000 });
    const mat = Date.now() - batDau;
    assert.ok(mat < 500, `trần 5000ms nhưng phải về sau ~40ms, thực tế ${mat}ms`);
  });

  it("hết trần thì NÉM, kèm mô tả - code sai vẫn phải đỏ", async () => {
    await assert.rejects(
      () => doiChoDenKhi(() => false, { tranMs: 60, nhipMs: 5, moTa: "việc không bao giờ xong" }),
      (err: Error) => {
        assert.match(err.message, /Hết 60ms/);
        assert.match(err.message, /việc không bao giờ xong/);
        return true;
      },
    );
  });

  it("điều kiện NÉM thì coi như chưa đúng và thử lại, không vỡ ngay lần đầu", async () => {
    let lan = 0;
    await doiChoDenKhi(
      () => {
        lan += 1;
        if (lan < 3) throw new Error("dòng chưa tồn tại");
        return true;
      },
      { nhipMs: 5 },
    );
    assert.equal(lan, 3, "phải thử lại qua 2 lần ném rồi mới thành công");
  });

  it("điều kiện ném MÃI thì thông điệp hết trần mang theo lỗi của lần thử cuối", async () => {
    await assert.rejects(
      () => doiChoDenKhi(() => { throw new Error("bảng chưa dựng"); }, { tranMs: 40, nhipMs: 5 }),
      (err: Error) => {
        assert.match(err.message, /lần thử cuối ném/);
        assert.match(err.message, /bảng chưa dựng/);
        return true;
      },
    );
  });

  it("nhận được cả điều kiện bất đồng bộ", async () => {
    let xong = false;
    setTimeout(() => (xong = true), 40);
    await doiChoDenKhi(async () => {
      await ngu(1);
      return xong;
    });
    assert.equal(xong, true);
  });
});

describe("doiChoSoLuong", () => {
  it("chờ tới khi đủ số lượng", async () => {
    const kho: number[] = [];
    for (let i = 1; i <= 3; i++) setTimeout(() => kho.push(i), i * 20);
    await doiChoSoLuong(() => kho.length, 3, { moTa: "số tin đã gửi" });
    assert.equal(kho.length, 3);
  });

  it("hết trần thì báo SỐ THẬT lúc hết trần, không phải số lúc bắt đầu chờ", async () => {
    const kho: number[] = [];
    // Có thêm 1 phần tử SAU khi bắt đầu chờ. Nếu thông điệp dựng sẵn lúc gọi
    // thì nó sẽ nói "chỉ đạt 0" - sai, và đúng chỗ dễ đọc nhầm nhất khi soi CI.
    setTimeout(() => kho.push(1), 20);
    await assert.rejects(
      () => doiChoSoLuong(() => kho.length, 5, { tranMs: 60, nhipMs: 5, moTa: "số tin đã gửi" }),
      (err: Error) => {
        assert.match(err.message, /số tin đã gửi chỉ đạt 1/);
        assert.match(err.message, /mong >= 5/);
        return true;
      },
    );
  });
});
