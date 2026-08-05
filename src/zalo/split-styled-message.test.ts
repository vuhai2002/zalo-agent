import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextStyle, type Style } from "zca-js";
import { markdownSangStyleZalo } from "./markdown-to-zalo-styles.js";
import { OVERFLOW_NOTE } from "./split-long-message.js";
import { splitStyledMessage } from "./split-styled-message.js";

/**
 * Module thuần, import tĩnh được.
 *
 * CÁCH KHẲNG ĐỊNH: luôn so ĐOẠN CHỮ mà span trỏ tới, không so con số. Ở bài
 * cắt tin thì con số đúng/sai chỉ lộ ra khi đem cắt thật - và đó chính là thứ
 * Zalo làm với `textProperties`.
 */

/** Mọi đoạn chữ được tô trong một tin, theo thứ tự */
function cacDoanTo(tin: { text: string; styles: Style[] }): string[] {
  return tin.styles.map((s) => tin.text.slice(s.start, s.start + s.len));
}

describe("splitStyledMessage", () => {
  it("tin ngắn: đi nguyên vẹn, style giữ y như cũ", () => {
    const goc = markdownSangStyleZalo("Giá **45.000đ** nhé");
    const phan = splitStyledMessage(goc, { maxChars: 2000, maxParts: 5 });
    assert.equal(phan.length, 1);
    assert.deepEqual(phan[0]!.styles, goc.styles);
    assert.deepEqual(cacDoanTo(phan[0]!), ["45.000đ"]);
  });

  it("không có style thì không đổi hành vi cắt cũ", () => {
    const dai = "câu dài. ".repeat(60);
    const phan = splitStyledMessage({ text: dai, styles: [] }, { maxChars: 100, maxParts: 10 });
    assert.ok(phan.length > 1);
    for (const p of phan) assert.deepEqual(p.styles, []);
  });

  it("ĐOẠN 2 TRỞ ĐI: mốc dời về đầu tin, không giữ mốc toàn văn", () => {
    // Đây là lỗi mặc định nếu quên dời mốc: span của đoạn sau vẫn mang số đếm
    // từ đầu toàn văn nên Zalo tô nhầm chỗ (hoặc bỏ vì vượt biên).
    const goc = markdownSangStyleZalo(`${"x".repeat(90)}\n\nPhần sau có **chữ đậm** ở đây`);
    const phan = splitStyledMessage(goc, { maxChars: 100, maxParts: 5 });
    assert.ok(phan.length >= 2, "phải cắt ra nhiều tin thì ca này mới có nghĩa");

    const coDam = phan.filter((p) => p.styles.length > 0);
    assert.equal(coDam.length, 1, "chỉ một đoạn chứa chữ đậm");
    assert.deepEqual(cacDoanTo(coDam[0]!), ["chữ đậm"]);
  });

  it("SPAN VẮT QUA CHỖ CẮT bị chẻ đôi, không mất và không tràn", () => {
    // Bản tham chiếu không giải bài này (nó cắt cụt thay vì chẻ tin).
    const dam = "ĐOẠN ĐẬM RẤT DÀI BỊ CẮT NGANG GIỮA CHỪNG";
    const goc = markdownSangStyleZalo(`${"a ".repeat(45)}**${dam}** đuôi`);
    const phan = splitStyledMessage(goc, { maxChars: 100, maxParts: 10 });

    const toDuoc = phan.flatMap(cacDoanTo).join(" ");
    // Từng chữ của đoạn đậm phải còn nằm trong vùng được tô ở đâu đó
    for (const tu of dam.split(" ")) {
      assert.ok(toDuoc.includes(tu), `mất chữ "${tu}" khỏi vùng tô sau khi cắt`);
    }
    // Và không được tràn sang chữ ngoài đoạn đậm
    assert.ok(!toDuoc.includes("đuôi"), "vùng tô tràn sang chữ không thuộc đoạn đậm");
    assert.ok(!toDuoc.includes("a a"), "vùng tô tràn ngược lên chữ phía trước");
  });

  it("MỌI span đều nằm trong biên của chính tin chứa nó", () => {
    // Bất biến quan trọng nhất: zca-js gói thẳng start/len vào JSON, không ai
    // kiểm hộ. Span vượt biên là dữ liệu hỏng gửi lên máy chủ Zalo.
    const doc = [
      "# Tiêu đề khá dài để chắc chắn bị đẩy qua ranh giới cắt",
      "Mở đầu **quan trọng** rồi *nghiêng* rồi ~~gạch~~ và `code`",
      ...Array.from({ length: 12 }, (_, i) => `- mục số ${i} có **phần đậm ${i}** nối dài thêm chữ`),
    ].join("\n");
    const goc = markdownSangStyleZalo(doc);

    for (const maxChars of [60, 100, 137, 200, 512]) {
      const phan = splitStyledMessage(goc, { maxChars, maxParts: 50 });

      // Chống xanh RỖNG: mốc lệch làm `len` ra âm và span bị bỏ hết, lúc đó
      // vòng kiểm biên bên dưới đúng một cách vô nghĩa. Phải còn span để kiểm.
      const tongSpan = phan.reduce((n, p) => n + p.styles.length, 0);
      assert.ok(
        tongSpan >= goc.styles.length,
        `maxChars=${maxChars}: mất span sau khi cắt (${tongSpan} < ${goc.styles.length})`,
      );

      for (const [i, p] of phan.entries()) {
        for (const s of p.styles) {
          assert.ok(s.start >= 0, `maxChars=${maxChars} tin ${i}: start âm ${s.start}`);
          assert.ok(s.len > 0, `maxChars=${maxChars} tin ${i}: span rỗng`);
          assert.ok(
            s.start + s.len <= p.text.length,
            `maxChars=${maxChars} tin ${i}: span vượt biên ${s.start}+${s.len} > ${p.text.length}`,
          );
        }
      }
    }
  });

  it("vùng tô KHÔNG BAO GIỜ dính ký tự markdown còn sót", () => {
    // Nếu mốc lệch, biểu hiện thường thấy nhất là vùng tô trượt sang ký tự bên
    // cạnh. Toàn văn đã sạch dấu markdown nên chỉ cần soi vùng tô.
    const doc = Array.from({ length: 20 }, (_, i) => `Dòng ${i} có **đậm ${i}** và *nghiêng ${i}*`).join("\n");
    const goc = markdownSangStyleZalo(doc);
    for (const p of splitStyledMessage(goc, { maxChars: 90, maxParts: 40 })) {
      for (const doan of cacDoanTo(p)) {
        assert.ok(!doan.includes("*"), `vùng tô dính dấu sao: "${doan}"`);
      }
    }
  });

  it("ghi chú 'còn nữa' ở đoạn cuối KHÔNG bị dính style của phần đã cắt bỏ", () => {
    // `phuGoc` sinh ra chính vì ca này: ghi chú là chữ THÊM VÀO, span thuộc
    // phần bị cắt bỏ mà lấy text.length làm phạm vi thì sẽ rơi trúng nó.
    const doc = Array.from({ length: 40 }, (_, i) => `đoạn ${i} **rất đậm ${i}** dài dài`).join("\n");
    const goc = markdownSangStyleZalo(doc);
    const phan = splitStyledMessage(goc, { maxChars: 120, maxParts: 3 });
    assert.equal(phan.length, 3, "phải chạm trần số tin thì mới có ghi chú");

    const cuoi = phan[2]!;
    const viTriGhiChu = cuoi.text.indexOf(OVERFLOW_NOTE);
    assert.ok(viTriGhiChu > 0, "đoạn cuối phải có ghi chú còn nữa");

    // Bất biến THẬT: không span nào chạm vào vùng ghi chú. Chỉ kiểm "trong biên"
    // là chưa đủ - lớp kẹp cuối giữ biên đúng ngay cả khi span đã trượt vào ghi
    // chú, nên phép phá `phuGoc` -> `text.length` lọt qua được.
    for (const s of cuoi.styles) {
      assert.ok(
        s.start + s.len <= viTriGhiChu,
        `style tràn vào ghi chú "còn nữa": ${s.start}+${s.len} > ${viTriGhiChu}`,
      );
    }
  });

  it("giữ nguyên indentSize khi chẻ - danh sách lồng không tụt cấp", () => {
    const goc = markdownSangStyleZalo("- cha\n  - con lồng vào trong");
    const phan = splitStyledMessage(goc, { maxChars: 2000, maxParts: 5 });
    const indent = phan[0]!.styles.find((s) => s.st === TextStyle.Indent);
    assert.ok(indent, "phải còn span Indent");
    assert.equal((indent as { indentSize?: number }).indentSize, 1);
  });
});
