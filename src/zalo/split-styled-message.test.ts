import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextStyle, type Style } from "zca-js";
import { markdownSangStyleZalo } from "./markdown-to-zalo-styles.js";
import { OVERFLOW_NOTE } from "./split-long-message.js";
import {
  chiaTheoNganSachByte,
  demDoanBoDinhDang,
  soByteTin,
  splitStyledMessage,
} from "./split-styled-message.js";

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
    // `markdownSangStyleZalo` không còn phát `Indent` (danh sách đi bằng chữ
    // thường), nhưng bộ cắt vẫn phải xử lý đúng span Indent do nơi khác đưa vào -
    // nó là hàm dùng chung, không phải phần phụ của bộ dịch markdown.
    const goc = {
      text: "cha\ncon lồng vào trong",
      styles: [{ start: 4, len: 18, st: TextStyle.Indent, indentSize: 1 }] as Style[],
    };
    const phan = splitStyledMessage(goc, { maxChars: 2000, maxParts: 5 });
    const indent = phan[0]!.styles.find((s) => s.st === TextStyle.Indent);
    assert.ok(indent, "phải còn span Indent");
    assert.equal((indent as { indentSize?: number }).indentSize, 1);
  });
});

describe("chiaTheoNganSachByte", () => {
  /** Văn bản kiểu bot hay trả: tiêu đề + danh sách dày số liệu in đậm */
  function taoVanBan(soDong: number): string {
    const dong: string[] = ["## Kết quả đối chiếu **hôm nay**"];
    for (let i = 1; i <= soDong; i++) {
      dong.push(`- Giải ${i}: **${10000 + i}** so với vé **${20000 + i}** thì **không trúng**`);
    }
    return dong.join("\n");
  }

  it("MỌI tin đều nằm dưới ngân sách byte", () => {
    // Bất biến gốc: Zalo trả mã 112 và bỏ cả tin khi chữ + định dạng cộng lại
    // vượt trần. Đo thật: 2867 byte gửi được, 3712 byte bị chối.
    const goc = markdownSangStyleZalo(taoVanBan(40));
    assert.ok(soByteTin(goc) > 2800, "văn bản mẫu phải đủ nặng thì ca này mới có nghĩa");

    const phan = chiaTheoNganSachByte(goc, { maxChars: 2000, maxParts: 8, maxPayloadBytes: 2800 });
    for (const [i, p] of phan.entries()) {
      assert.ok(
        soByteTin(p) <= 2800,
        `tin ${i} nặng ${soByteTin(p)} byte, vượt trần 2800 - Zalo sẽ trả mã 112`,
      );
    }
  });

  it("cắt NHỎ HƠN chứ không vứt định dạng", () => {
    // Người dùng nhận thêm một tin thì vẫn đọc được; mất định dạng là mất đúng
    // thứ vừa làm ra. Chỉ bỏ định dạng khi co hết cỡ vẫn không lọt.
    const goc = markdownSangStyleZalo(taoVanBan(40));
    const phan = chiaTheoNganSachByte(goc, { maxChars: 2000, maxParts: 8, maxPayloadBytes: 2800 });

    assert.ok(phan.length > 1, "phải cắt ra nhiều tin");
    const coStyle = phan.filter((p) => p.styles.length > 0).length;
    assert.equal(coStyle, phan.length, "không tin nào được phép mất định dạng ở ca này");
  });

  it("DÙNG HẾT suất tin được phép, không chừa lại một suất rồi bỏ định dạng", () => {
    // Bản đầu chặn vòng co bằng `thu.length >= maxParts` - đo sai đại lượng.
    // Chạm ĐÚNG trần số tin không phải mất chữ, nhưng nó vẫn vứt kết quả tốt.
    // Đo trên tin thật: bước co cho ra 5 tin, mọi tin dưới trần, không hụt chữ,
    // vậy mà chốt chặn nổ và giữ bản 3 tin có một tin 3754 byte -> bỏ định dạng.
    // Người dùng nhận tin đầu phẳng lì mà log không hề nhắc gì.
    // 60 dòng CỐ Ý: đo thật cho thấy văn bản nhẹ hơn không đi qua nhánh hỏng
    // (chốt chặn cũ chỉ nổ khi vòng co chạm đúng trần số tin). Fixture 38 dòng
    // của bản đầu xanh với CẢ hai bản code - tức là không kiểm được gì.
    const goc = markdownSangStyleZalo(taoVanBan(60));
    const phan = chiaTheoNganSachByte(goc, { maxChars: 2000, maxParts: 5, maxPayloadBytes: 2800 });

    const mat = phan.filter((p) => p.styles.length === 0);
    assert.equal(
      mat.length,
      0,
      `${mat.length}/${phan.length} tin mất định dạng dù còn suất để cắt nhỏ hơn`,
    );
  });

  it("co tới trần vẫn giữ ĐỦ CHỮ - không được đánh đổi chữ lấy định dạng", () => {
    // Vòng co dừng đúng lúc: cắt mịn hơn thì `trimEnd` ở ranh giới ăn vài ký tự
    // trắng (chấp nhận được), nhưng vứt cả đoạn văn thì không.
    const doc = taoVanBan(38);
    const goc = markdownSangStyleZalo(doc);
    const phan = chiaTheoNganSachByte(goc, { maxChars: 2000, maxParts: 5, maxPayloadBytes: 2800 });

    const daGiao = phan.map((p) => p.text).join("");
    assert.ok(!daGiao.includes(OVERFLOW_NOTE), "không được vứt chữ kèm ghi chú 'còn nữa'");
    // Mỗi ranh giới cắt ăn nhiều nhất vài ký tự trắng
    assert.ok(
      daGiao.length >= goc.text.length - phan.length * 3,
      `hụt ${goc.text.length - daGiao.length} ký tự, quá mức trim ở ranh giới`,
    );
  });

  it("đoạn KHÔNG CÓ GÌ ĐỂ TÔ không bị đánh dấu là mất định dạng", () => {
    // Báo động giả đã xảy ra thật: đoạn cuối câu trả lời chỉ là văn xuôi nên
    // `styles` rỗng tự nhiên, mà nơi gửi suy ra từ độ dài rồi kêu "đoạn quá
    // nặng". Cờ `boDinhDang` sinh ra chính vì ca này.
    const goc = markdownSangStyleZalo(
      `## Tiêu đề **đậm**\n${"Đoạn văn xuôi dài không có dấu markdown nào cả. ".repeat(40)}`,
    );
    const phan = chiaTheoNganSachByte(goc, { maxChars: 900, maxParts: 5, maxPayloadBytes: 3250 });

    const rong = phan.filter((p) => p.styles.length === 0);
    assert.ok(rong.length > 0, "phải có đoạn không chứa chữ nào cần tô thì ca này mới có nghĩa");
    for (const p of rong) {
      assert.equal(p.boDinhDang, undefined, "đoạn vốn không có gì để tô KHÔNG phải là mất định dạng");
    }
  });

  it("đoạn THẬT SỰ bị bỏ định dạng thì có cờ để nơi gửi kêu lên", () => {
    const goc = markdownSangStyleZalo(taoVanBan(60));
    const phan = chiaTheoNganSachByte(goc, { maxChars: 2000, maxParts: 2, maxPayloadBytes: 1200 });

    const bo = phan.filter((p) => p.boDinhDang);
    assert.ok(bo.length > 0, "co hết cỡ vẫn vượt trần thì phải có đoạn bị bỏ định dạng");
    for (const p of bo) assert.deepEqual(p.styles, [], "đã bỏ thì không được còn span nào");
  });

  it("KHÔNG cắt vụn khi tin vốn đã nhẹ", () => {
    // Co trần vô cớ là bắt người ta đọc nhiều tin hơn cần thiết.
    const goc = markdownSangStyleZalo("Giá **45.000đ** nhé anh Hải");
    const phan = chiaTheoNganSachByte(goc, { maxChars: 2000, maxParts: 5, maxPayloadBytes: 2800 });
    assert.equal(phan.length, 1);
    assert.ok(phan[0]!.styles.length > 0);
  });

  it("chạm trần SỐ TIN thì thà bỏ định dạng còn hơn vứt chữ", () => {
    // Co tiếp là chữ bị cắt kèm ghi chú "còn nữa". Mất chữ tệ hơn mất định dạng.
    const goc = markdownSangStyleZalo(taoVanBan(60));
    const phan = chiaTheoNganSachByte(goc, { maxChars: 2000, maxParts: 2, maxPayloadBytes: 1200 });

    // Bất biến ĐÚNG: trần byte chỉ áp cho tin CÓ định dạng. Đã đo thật - cùng
    // đoạn chữ 2321 byte, gửi trơn thì được, kèm style thì bị chối. Nên tin nào
    // vượt trần BẮT BUỘC phải rỗng style; còn chữ thì không được đụng tới.
    for (const p of phan) {
      assert.ok(
        soByteTin(p) <= 1200 || p.styles.length === 0,
        `tin ${soByteTin(p)} byte vượt trần mà VẪN mang ${p.styles.length} style`,
      );
    }
    assert.ok(phan.length <= 2, "không được vượt trần số tin");
  });

  it("chữ tiếng Việt tính theo BYTE UTF-8, không theo số ký tự", () => {
    // Dấu tiếng Việt tốn 2-3 byte mỗi ký tự. Đếm ký tự thì tin tiếng Việt lọt
    // trần trên giấy nhưng vẫn bị Zalo chối.
    const viet = { text: "Đường Nguyễn Huệ", styles: [] };
    assert.ok(
      soByteTin(viet) > viet.text.length,
      "chuỗi có dấu phải nặng hơn số ký tự của nó",
    );
  });

  it("tin KHÔNG có định dạng thì không bị co - trần này chỉ của tin có style", () => {
    // Đã đo: cùng đoạn chữ 2321 byte, không style thì gửi được, có style thì chối.
    const dai = "câu dài không dấu markdown. ".repeat(120);
    const phan = chiaTheoNganSachByte(
      { text: dai, styles: [] },
      { maxChars: 2000, maxParts: 8, maxPayloadBytes: 2800 },
    );
    const theoKyTu = splitStyledMessage({ text: dai, styles: [] }, { maxChars: 2000, maxParts: 8 });
    assert.equal(phan.length, theoKyTu.length, "không style thì phải cắt y như cũ");
  });
});

describe("demDoanBoDinhDang", () => {
  it("đoạn styles rỗng mà KHÔNG có cờ thì không tính là mất định dạng", () => {
    // Đây đúng là báo động giả đã xảy ra thật: đoạn cuối câu trả lời chỉ là văn
    // xuôi nên `styles` rỗng tự nhiên, mà nơi gửi suy ra từ độ dài rồi kêu
    // "đoạn quá nặng so với trần byte".
    assert.equal(
      demDoanBoDinhDang([
        { text: "có tô", styles: [{ start: 0, len: 2, st: TextStyle.Bold }] },
        { text: "văn xuôi thuần", styles: [] },
      ]),
      0,
    );
  });

  it("chỉ đếm đoạn có cờ boDinhDang", () => {
    assert.equal(
      demDoanBoDinhDang([
        { text: "a", styles: [] },
        { text: "b", styles: [], boDinhDang: true },
        { text: "c", styles: [], boDinhDang: true },
      ]),
      2,
    );
  });
});
