import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { doiChoDenKhi } from "../shared/doi-cho-den-khi.js";
import { resetHangDoiTaiVideo, trangThaiHangDoi, xepHangTaiVideo } from "./hang-doi-tai-video.js";

afterEach(() => resetHangDoiTaiVideo());

/** Một việc treo cho tới khi test tự gọi `xong()` - giữ suất mà không cần đồng hồ */
function viecTreo() {
  let xong!: () => void;
  let hong!: (e: unknown) => void;
  const p = new Promise<void>((res, rej) => {
    xong = res;
    hong = rej;
  });
  return { p, xong, hong };
}

describe("hàng đợi tải video", () => {
  it("trần 2: việc thứ 3 phải CHỜ tới khi có suất trống", async () => {
    const a = viecTreo();
    const b = viecTreo();
    const c = viecTreo();
    let cDaChay = false;

    void xepHangTaiVideo(() => a.p, 2);
    void xepHangTaiVideo(() => b.p, 2);
    void xepHangTaiVideo(() => {
      cDaChay = true;
      return c.p;
    }, 2);

    await doiChoDenKhi(() => trangThaiHangDoi().dangChay === 2, { moTa: "2 việc chạy" });
    assert.equal(cDaChay, false, "việc thứ 3 KHÔNG được chạy khi đã có 2 việc đang chạy");
    assert.equal(trangThaiHangDoi().dangCho, 1);

    a.xong();
    await doiChoDenKhi(() => cDaChay, { moTa: "việc thứ 3 chạy sau khi có suất trống" });

    b.xong();
    c.xong();
  });

  it("việc HỎNG vẫn nhả suất - không thì hàng đợi tắc vĩnh viễn", async () => {
    const a = viecTreo();
    let bDaChay = false;

    const pa = xepHangTaiVideo(() => a.p, 1);
    void xepHangTaiVideo(async () => {
      bDaChay = true;
    }, 1);

    await doiChoDenKhi(() => trangThaiHangDoi().dangChay === 1, { moTa: "việc đầu chạy" });
    assert.equal(bDaChay, false);

    a.hong(new Error("hỏng"));
    await assert.rejects(pa, /hỏng/);
    await doiChoDenKhi(() => bDaChay, { moTa: "việc sau vẫn chạy sau khi việc trước hỏng" });
  });

  it("việc ném ĐỒNG BỘ vẫn nhả suất - không thì hàng đợi kẹt vĩnh viễn", async () => {
    // Ca này khác ca "việc HỎNG" ở trên: đó là promise bị từ chối, còn đây là
    // hàm KHÔNG async ném thẳng. `dangChay++` chạy trước `viec.chay()`, nên nếu
    // không bọc thì chuỗi `.finally()` không được dựng và suất rò vĩnh viễn.
    // Đo trên bản chưa vá: 2 lần ném đồng bộ là hàng đợi kẹt hẳn.
    const nem = () => {
      throw new Error("ném đồng bộ");
    };
    await assert.rejects(xepHangTaiVideo(nem as unknown as () => Promise<void>, 1), /ném đồng bộ/);
    await assert.rejects(xepHangTaiVideo(nem as unknown as () => Promise<void>, 1), /ném đồng bộ/);

    assert.deepEqual(
      trangThaiHangDoi(),
      { dangChay: 0, dangCho: 0 },
      "suất bị rò sau khi việc ném đồng bộ",
    );
    // Chốt thật sự: hàng đợi CÒN DÙNG ĐƯỢC sau đó.
    assert.equal(await xepHangTaiVideo(async () => "van chay duoc", 1), "van chay duoc");
  });

  it("lỗi được ném NGUYÊN VẸN ra ngoài, hàng đợi không nuốt", async () => {
    // Nuốt lỗi thì tool không biết vì sao hỏng, người dùng nhận câu chung chung.
    const rieng = new Error("lý do rất riêng");
    await assert.rejects(
      xepHangTaiVideo(async () => {
        throw rieng;
      }, 2),
      (e: unknown) => e === rieng,
    );
  });

  it("trả về ĐÚNG giá trị của việc", async () => {
    assert.equal(await xepHangTaiVideo(async () => 42, 2), 42);
  });

  it("trần lấy từ lời gọi MỚI NHẤT - đổi trên dashboard là ăn ngay", async () => {
    // Trần truyền vào MỖI LẦN xếp hàng chứ không phải setter toàn cục gọi lúc
    // khởi động. Bản đầu của file này dùng setter và QUÊN NỐI vào `index.ts` -
    // hàng đợi chạy với số mặc định, người dùng chỉnh dashboard không thấy gì
    // đổi, và không có gì báo.
    const a = viecTreo();
    const b = viecTreo();
    let bDaChay = false;

    void xepHangTaiVideo(() => a.p, 1);
    void xepHangTaiVideo(() => {
      bDaChay = true;
      return b.p;
    }, 1);

    await doiChoDenKhi(() => trangThaiHangDoi().dangChay === 1, { moTa: "1 việc chạy với trần 1" });
    assert.equal(bDaChay, false, "trần 1 thì việc thứ hai phải chờ");

    // Xếp một việc mới với trần 2 - mô phỏng người dùng vừa nâng cấu hình
    void xepHangTaiVideo(async () => {}, 2);
    await doiChoDenKhi(() => bDaChay, { moTa: "việc đang chờ chạy sau khi nâng trần" });

    a.xong();
    b.xong();
  });

  it("trần 0 vẫn chạy được 1 - cấu hình lỗi không được làm treo cả tính năng", async () => {
    assert.equal(await xepHangTaiVideo(async () => "chay duoc", 0), "chay duoc");
  });

  it("nhiều việc xếp hàng thì chạy HẾT, không bỏ sót", async () => {
    const xong: number[] = [];
    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        xepHangTaiVideo(async () => {
          xong.push(i);
        }, 2),
      ),
    );
    assert.equal(xong.length, 7);
    assert.deepEqual(
      [...xong].sort((x, y) => x - y),
      [0, 1, 2, 3, 4, 5, 6],
    );
    assert.deepEqual(trangThaiHangDoi(), { dangChay: 0, dangCho: 0 });
  });
});
