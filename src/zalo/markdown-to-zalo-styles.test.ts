import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextStyle } from "zca-js";
import { markdownSangStyleZalo } from "./markdown-to-zalo-styles.js";

/**
 * Module thuần, không chạm DB nên import tĩnh được.
 *
 * CÁCH KHẲNG ĐỊNH: hầu hết ca đều kiểm `text.slice(start, start + len)` ra
 * ĐÚNG đoạn chữ mong muốn, thay vì so `start`/`len` với số tự tính tay. Số tự
 * tính tay thì lỗi số học của người viết test và lỗi của code triệt tiêu nhau,
 * còn lát cắt thì chứng minh thẳng "Zalo sẽ tô đúng chỗ này".
 */

/** Đoạn chữ mà một span trỏ tới - dùng để khẳng định căn lề */
function doanCua(ket: { text: string; styles: { start: number; len: number }[] }, i: number): string {
  const s = ket.styles[i]!;
  return ket.text.slice(s.start, s.start + s.len);
}

describe("markdownSangStyleZalo - inline", () => {
  it("chữ thường không sinh style nào", () => {
    const ket = markdownSangStyleZalo("Chào anh Hải, hôm nay trời đẹp.");
    assert.equal(ket.text, "Chào anh Hải, hôm nay trời đẹp.");
    assert.deepEqual(ket.styles, []);
  });

  it("**đậm** bóc dấu và tô ĐÚNG đoạn chữ", () => {
    const ket = markdownSangStyleZalo("Giá là **45.000 đồng** nhé");
    assert.equal(ket.text, "Giá là 45.000 đồng nhé", "dấu ** phải biến mất khỏi chữ");
    assert.equal(ket.styles.length, 1);
    assert.equal(ket.styles[0]!.st, TextStyle.Bold);
    assert.equal(doanCua(ket, 0), "45.000 đồng");
  });

  it("dấu tiếng Việt KHÔNG làm lệch offset", () => {
    // Mọi ký tự có dấu ở đây đều là một đơn vị UTF-16, nhưng ca này là lưới đỡ
    // cho lần ai đó đổi cách đếm.
    const ket = markdownSangStyleZalo("Đường Nguyễn Huệ có **quán cà phê Đợi** rất đông");
    assert.equal(doanCua(ket, 0), "quán cà phê Đợi");
  });

  it("EMOJI trước đoạn đậm vẫn căn đúng - offset là đơn vị UTF-16", () => {
    // Emoji là cặp surrogate = 2 đơn vị UTF-16. Đếm theo code point sẽ lệch
    // toàn bộ phần sau emoji đầu tiên, mà tin nhắn thật đầy emoji.
    const ket = markdownSangStyleZalo("🔥🎉 Khuyến mãi **giảm 50%** hôm nay");
    assert.equal(
      doanCua(ket, 0),
      "giảm 50%",
      "lệch ở đây nghĩa là Zalo tô đậm nhầm chỗ ngay khi tin có emoji",
    );
  });

  it("nhiều cặp dấu KHÁC NHAU trên cùng một dòng - span sau không bị trôi", () => {
    // Đây là cái bẫy bản tham chiếu đã dính thật: pass sau xóa ký tự nằm TRƯỚC
    // span pass trước đã ghi, span cũ trôi mà không ai chỉnh lại.
    const ket = markdownSangStyleZalo("**Đậm** rồi ~~gạch~~ rồi *nghiêng*");
    assert.equal(ket.text, "Đậm rồi gạch rồi nghiêng");
    const theoChu = Object.fromEntries(
      ket.styles.map((_s, i) => [doanCua(ket, i), ket.styles[i]!.st]),
    );
    assert.deepEqual(theoChu, {
      "Đậm": TextStyle.Bold,
      "gạch": TextStyle.StrikeThrough,
      "nghiêng": TextStyle.Italic,
    });
  });

  it("gạch dưới KHÔNG bị đụng tới - tên file thật đầy dấu đó", () => {
    // Quyết định đã có từ `sanitize-reply-text.ts`: bắt `__x__`/`_x_` là đổi
    // hỏng dữ liệu thật như `bao_gia_2026.pdf`.
    const ket = markdownSangStyleZalo("File bao_gia_2026.pdf và __ghi chú__ giữ nguyên");
    assert.equal(ket.text, "File bao_gia_2026.pdf và __ghi chú__ giữ nguyên");
    assert.deepEqual(ket.styles, []);
  });

  it("`code` thành đậm vì Zalo không có font mono", () => {
    const ket = markdownSangStyleZalo("Chạy lệnh `pnpm dev` nhé");
    assert.equal(ket.text, "Chạy lệnh pnpm dev nhé");
    assert.equal(ket.styles[0]!.st, TextStyle.Bold);
    assert.equal(doanCua(ket, 0), "pnpm dev");
  });
});

describe("markdownSangStyleZalo - khối", () => {
  it("tiêu đề thành to + đậm, dấu # biến mất", () => {
    const ket = markdownSangStyleZalo("## Bảng giá hôm nay");
    assert.equal(ket.text, "Bảng giá hôm nay");
    assert.deepEqual(
      ket.styles.map((s) => s.st).sort(),
      [TextStyle.Big, TextStyle.Bold].sort(),
    );
    assert.equal(doanCua(ket, 0), "Bảng giá hôm nay");
  });

  it("gạch đầu dòng và đánh số thành danh sách của Zalo", () => {
    const ket = markdownSangStyleZalo("- cà phê đen\n- cà phê sữa");
    assert.equal(ket.text, "cà phê đen\ncà phê sữa", "dấu gạch đầu dòng do Zalo tự vẽ");
    assert.equal(ket.styles.length, 2);
    assert.equal(doanCua(ket, 0), "cà phê đen");
    assert.equal(doanCua(ket, 1), "cà phê sữa", "dòng THỨ HAI phải cộng dồn offset qua ký tự xuống dòng");
    for (const s of ket.styles) assert.equal(s.st, TextStyle.UnorderedList);
  });

  it("danh sách lồng sinh thêm Indent theo cấp", () => {
    const ket = markdownSangStyleZalo("- cha\n  - con");
    const indent = ket.styles.find((s) => s.st === TextStyle.Indent);
    assert.ok(indent, "dòng lồng phải có Indent");
    assert.equal((indent as { indentSize?: number }).indentSize, 1);
  });

  it("nhiều dòng trộn khối và inline - mọi span vẫn trỏ đúng chỗ", () => {
    const ket = markdownSangStyleZalo("# Tiêu đề\nMở đầu **quan trọng** ở đây\n- mục **một**");
    for (let i = 0; i < ket.styles.length; i++) {
      const doan = doanCua(ket, i);
      assert.ok(doan.length > 0, `span ${i} trỏ vào chuỗi rỗng - dấu hiệu lệch offset`);
      assert.ok(!doan.includes("*") && !doan.includes("#"), `span ${i} còn dính dấu markdown: ${doan}`);
    }
    assert.ok(ket.text.includes("quan trọng"));
    assert.ok(!ket.text.includes("**"), "không còn dấu ** trong chữ cuối");
  });

  it("dòng kẻ ngăn của bảng bị bỏ, dòng dữ liệu giữ nguyên", () => {
    const ket = markdownSangStyleZalo("| Loại | Giá |\n|---|---|\n| Đen | 20k |");
    assert.ok(!ket.text.includes("---"), "dòng kẻ ngăn phải biến mất");
    assert.ok(ket.text.includes("| Đen | 20k |"), "dòng dữ liệu phải còn nguyên");
  });

  it("NỘI DUNG TRONG KHỐI CODE giữ nguyên xi, không bị hiểu là markdown", () => {
    // Đây đúng là lỗi mà `sanitize-code-block.ts` được viết ra để chữa: gỡ rào
    // sớm thì `# Tính tổng` bị coi là tiêu đề và code trả về sai cú pháp.
    const ket = markdownSangStyleZalo("Đoạn Python:\n```python\n# Tính tổng\n- a = 1\n*x = 2\n```\nxong");
    assert.ok(ket.text.includes("# Tính tổng"), "dấu thăng của comment Python phải còn");
    assert.ok(ket.text.includes("- a = 1"), "dấu gạch trong code phải còn");
    assert.ok(ket.text.includes("*x = 2"), "dấu sao trong code phải còn");
    assert.ok(!ket.text.includes("```"), "hàng rào thì bỏ");
    assert.deepEqual(ket.styles, [], "không span nào phát ra từ code");
  });

  it("rào code CÙNG DÒNG chỉ bị gỡ rào, không nuốt chữ", () => {
    const ket = markdownSangStyleZalo("Chạy ```pnpm dev``` là xong");
    assert.equal(ket.text, "Chạy pnpm dev là xong");
  });

  it("[chữ](url) thành 'chữ (url)' để link vẫn bấm được", () => {
    const ket = markdownSangStyleZalo("Xem [bảng giá](https://vd.test/gia) nhé");
    assert.equal(ket.text, "Xem bảng giá (https://vd.test/gia) nhé");
  });
});

describe("markdownSangStyleZalo - an toàn", () => {
  it("KHÔNG NUỐT CHỮ: mọi ký tự không phải dấu markdown đều còn lại", () => {
    // Luật số 1 của lớp làm sạch: hàm này chạm MỌI câu trả lời, nuốt chữ còn
    // tệ hơn nhiều so với để lọt vài ký tự định dạng.
    const goc = "Anh Hải ơi, giá **45.000đ** cho *2 ly* - gồm cà phê & sữa (100% arabica)!";
    const ket = markdownSangStyleZalo(goc);
    for (const chu of ["Anh Hải ơi", "45.000đ", "2 ly", "cà phê & sữa", "100% arabica"]) {
      assert.ok(ket.text.includes(chu), `mất đoạn "${chu}"`);
    }
  });

  it("ký tự mốc do model sinh ra không phá được việc token hóa", () => {
    // MOC là U+0001. Model JSON escape ra nó được, và chuỗi dạng MOC+số+MOC va
    // đúng token thì `apDungInline` sẽ nhét nhầm nội dung.
    const doc = `${String.fromCharCode(1)}0${String.fromCharCode(1)} và **đậm thật**`;
    const ket = markdownSangStyleZalo(doc);
    assert.ok(!ket.text.includes(String.fromCharCode(1)), "ký tự mốc phải bị dọn khỏi chữ");
    assert.equal(doanCua(ket, 0), "đậm thật", "đoạn đậm THẬT vẫn phải đúng chỗ");
  });

  it("mọi span đều nằm trong biên của chuỗi", () => {
    const ket = markdownSangStyleZalo("# Tiêu đề **đậm**\n- mục *nghiêng*\n  - lồng `code`");
    for (const s of ket.styles) {
      assert.ok(s.start >= 0, `start âm: ${s.start}`);
      assert.ok(s.start + s.len <= ket.text.length, `span vượt biên: ${s.start}+${s.len} > ${ket.text.length}`);
      assert.ok(s.len > 0, "span rỗng không có nghĩa gì");
    }
  });
});
