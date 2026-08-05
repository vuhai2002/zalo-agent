import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demKieu, doanTheoKieu, dungGocNhinDinhDang, KIEU } from "./eval-formatting-view.js";

/**
 * Module thuần. Đây là mảnh hạ tầng khiến eval NHÌN THẤY được định dạng, nên
 * chính nó phải đúng: cắt sai `chu` một chỗ là mọi khẳng định dựa trên nó nói
 * dối mà vẫn xanh.
 */

describe("dungGocNhinDinhDang", () => {
  it("cắt ĐÚNG đoạn chữ mà mỗi span phủ", () => {
    // Khẳng định "có 5 span đậm" gần như vô nghĩa; "span đậm phủ đúng chữ này"
    // mới là thứ người đọc cảm nhận được.
    // `start` CỐ Ý khác 0: với start = 0 thì `slice(start, len)` và
    // `slice(start, start + len)` ra kết quả y hệt, ca đo được thành xanh rỗng.
    const msg = "Bot có thể: Tra cứu web: tin tức";
    const nhan = "Tra cứu web:";
    const dd = dungGocNhinDinhDang([
      { msg, styles: [{ start: msg.indexOf(nhan), len: nhan.length, st: "b" }] },
    ]);
    assert.deepEqual(dd.span, [{ st: "b", chu: nhan, tin: 1 }]);
  });

  it("đánh số tin ĐÚNG khi câu trả lời bị cắt nhiều tin", () => {
    const dd = dungGocNhinDinhDang([
      { msg: "một", styles: [{ start: 0, len: 3, st: "b" }] },
      { msg: "hai", styles: [{ start: 0, len: 3, st: "i" }] },
    ]);
    assert.deepEqual(dd.span.map((s) => s.tin), [1, 2]);
    assert.equal(dd.soTin, 2);
  });

  it("tin KHÔNG có styles không sinh span nào", () => {
    const dd = dungGocNhinDinhDang([{ msg: "chữ trơn" }, { msg: "cũng trơn", styles: [] }]);
    assert.deepEqual(dd.span, []);
    assert.equal(dd.soTin, 2);
  });

  it("dấu tiếng Việt và emoji không làm lệch lát cắt", () => {
    // `start`/`len` là đơn vị UTF-16; emoji là cặp surrogate = 2 đơn vị.
    const msg = "🔥 Giá **45.000đ**".replace(/\*\*/g, "");
    const dd = dungGocNhinDinhDang([
      { msg, styles: [{ start: msg.indexOf("45.000đ"), len: "45.000đ".length, st: "b" }] },
    ]);
    assert.equal(dd.span[0]!.chu, "45.000đ");
  });

  it("doanTheoKieu và demKieu lọc đúng theo mã style", () => {
    const dd = dungGocNhinDinhDang([
      {
        msg: "Nhãn cam và chữ đậm",
        styles: [
          { start: 0, len: 8, st: KIEU.cam },
          { start: 13, len: 6, st: KIEU.dam },
        ],
      },
    ]);
    assert.deepEqual(doanTheoKieu(dd, KIEU.cam), ["Nhãn cam"]);
    assert.equal(demKieu(dd, KIEU.dam), 1);
    assert.equal(demKieu(dd, KIEU.xanh), 0);
  });
});
