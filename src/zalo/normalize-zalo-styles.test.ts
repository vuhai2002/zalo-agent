import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextStyle, type Style } from "zca-js";
import { markdownSangStyleZalo } from "./markdown-to-zalo-styles.js";
import { chuanHoaStyles } from "./normalize-zalo-styles.js";

/**
 * Module thuần, import tĩnh được.
 *
 * Bất biến gốc: KHÔNG span nào chồng span CÙNG KIỂU. Zalo trả mã 112 và bỏ cả
 * tin khi gặp - đã mất một câu trả lời thật vì chuyện này.
 */

/** Đếm số cặp span cùng kiểu mà giao nhau - phải luôn bằng 0 sau chuẩn hóa */
function demCapChong(styles: Style[]): number {
  let n = 0;
  for (let i = 0; i < styles.length; i++) {
    for (let j = i + 1; j < styles.length; j++) {
      const a = styles[i]!;
      const b = styles[j]!;
      if (a.st !== b.st) continue;
      if (Math.min(a.start + a.len, b.start + b.len) > Math.max(a.start, b.start)) n++;
    }
  }
  return n;
}

const dam = (start: number, len: number): Style => ({ start, len, st: TextStyle.Bold });

describe("chuanHoaStyles", () => {
  it("span đậm con NẰM TRONG span đậm cha bị gộp làm một", () => {
    // Đúng hình dạng đã làm hỏng lượt 116: tiêu đề đậm cả dòng, bên trong còn
    // một đoạn **đậm** nữa.
    const ra = chuanHoaStyles([dam(72, 28), dam(94, 6)]);
    assert.deepEqual(ra, [dam(72, 28)], "span con thừa, phải biến mất");
  });

  it("hai span đậm chồng MỘT PHẦN gộp thành span phủ cả hai", () => {
    const ra = chuanHoaStyles([dam(0, 10), dam(5, 10)]);
    assert.deepEqual(ra, [dam(0, 15)]);
  });

  it("hai span đậm CHẠM NHAU cũng gộp - nhìn ra kết quả y hệt", () => {
    const ra = chuanHoaStyles([dam(0, 5), dam(5, 5)]);
    assert.deepEqual(ra, [dam(0, 10)]);
  });

  it("hai span đậm RỜI NHAU giữ nguyên - không được nối bừa qua chữ ở giữa", () => {
    const ra = chuanHoaStyles([dam(0, 5), dam(8, 5)]);
    assert.equal(ra.length, 2, "nối lại là tô đậm luôn chữ không được đánh dấu");
  });

  it("KHÁC kiểu tô thì KHÔNG gộp, dù trùng khít vị trí", () => {
    // Tiêu đề = Big + Bold cùng phạm vi. Đây là cặp bản tham chiếu dùng thật,
    // gộp nhầm là mất một trong hai.
    const ra = chuanHoaStyles([
      { start: 0, len: 10, st: TextStyle.Big },
      { start: 0, len: 10, st: TextStyle.Bold },
    ]);
    assert.equal(ra.length, 2);
    assert.deepEqual(new Set(ra.map((s) => s.st)), new Set([TextStyle.Big, TextStyle.Bold]));
  });

  it("Indent KHÁC CẤP thì không gộp - gộp là làm phẳng danh sách lồng", () => {
    const ra = chuanHoaStyles([
      { start: 0, len: 10, st: TextStyle.Indent, indentSize: 1 },
      { start: 0, len: 10, st: TextStyle.Indent, indentSize: 2 },
    ]);
    assert.equal(ra.length, 2, "cấp 1 và cấp 2 là hai định dạng khác nhau");
  });

  it("kết quả LUÔN sắp theo start, span dài đứng trước khi cùng start", () => {
    const ra = chuanHoaStyles([
      dam(25, 3),
      { start: 13, len: 10, st: TextStyle.Indent, indentSize: 1 },
      { start: 13, len: 20, st: TextStyle.UnorderedList },
      dam(0, 2),
    ]);
    assert.deepEqual(
      ra.map((s) => s.start),
      [0, 13, 13, 25],
    );
    assert.equal(ra[1]!.len, 20, "cùng start thì span dài đứng trước");
  });

  it("mảng rỗng và một phần tử đi qua không đổi", () => {
    assert.deepEqual(chuanHoaStyles([]), []);
    assert.deepEqual(chuanHoaStyles([dam(3, 4)]), [dam(3, 4)]);
  });
});

describe("markdownSangStyleZalo - không bao giờ phát span chồng cùng kiểu", () => {
  it("TIÊU ĐỀ CÓ IN ĐẬM BÊN TRONG - đúng ca đã làm Zalo trả mã 112", () => {
    const ket = markdownSangStyleZalo("## 1. Vé Tiền Giang - số **418512**");
    assert.equal(demCapChong(ket.styles), 0, "còn span chồng là Zalo còn bỏ cả tin");

    // Vẫn phải CÒN định dạng, không phải chữa bằng cách vứt hết đi
    const kieu = new Set(ket.styles.map((s) => s.st));
    assert.ok(kieu.has(TextStyle.Big), "tiêu đề phải còn to");
    assert.ok(kieu.has(TextStyle.Bold), "tiêu đề phải còn đậm");
  });

  it("văn bản trộn đủ thứ: 0 cặp chồng, và span sắp theo vị trí", () => {
    const doc = [
      "## Kết quả **hôm nay**",
      "- mục **một** và *nghiêng*",
      "  - lồng **hai** với `code`",
      "### Chốt lại: **xong**",
    ].join("\n");
    const ket = markdownSangStyleZalo(doc);

    assert.equal(demCapChong(ket.styles), 0);
    const sapXep = ket.styles.every((s, i) => i === 0 || ket.styles[i - 1]!.start <= s.start);
    assert.ok(sapXep, `span không theo thứ tự: ${ket.styles.map((s) => s.start).join(",")}`);
  });
});
