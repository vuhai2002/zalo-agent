import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coDauHieuRoPrompt, lamSachTraLoi } from "./sanitize-reply-text.js";
import { DAU_HIEU_RO_PROMPT } from "../agent/prompt-leak-markers.js";

/** Module thuần - không cần setupTestEnv, không cần import động */

const sach = (t: string) => lamSachTraLoi(t).text;

describe("lamSachTraLoi - bỏ markdown, GIỮ nội dung", () => {
  it("in đậm", () => {
    assert.equal(sach("Giá vàng **tăng mạnh** hôm nay"), "Giá vàng tăng mạnh hôm nay");
  });

  it("in nghiêng", () => {
    assert.equal(sach("Đây là *ghi chú* nhỏ"), "Đây là ghi chú nhỏ");
  });

  it("đậm và nghiêng lồng nhau - đậm xử trước nên không còn dấu sao lẻ", () => {
    assert.equal(sach("**rất** *quan trọng*"), "rất quan trọng");
    assert.ok(!sach("**đậm** và *nghiêng*").includes("*"));
  });

  it("inline code", () => {
    assert.equal(sach("Chạy lệnh `pnpm dev` nhé"), "Chạy lệnh pnpm dev nhé");
  });

  it("khối code - giữ nội dung, bỏ hàng rào và nhãn ngôn ngữ", () => {
    const ra = sach("Đây là code:\n```js\nconst a = 1;\n```\nXong rồi");
    assert.ok(!ra.includes("```"), ra);
    assert.ok(!ra.includes("js\n"), `nhãn ngôn ngữ phải bị bỏ: ${ra}`);
    assert.match(ra, /const a = 1;/);
    assert.match(ra, /Xong rồi/);
  });

  it("khối code viết trên MỘT dòng giữ nguyên nội dung", () => {
    // Vòng rà soát bắt được: bản đầu để `[^\n`]*\n?` ăn nhãn ngôn ngữ, nên với
    // fence cùng dòng nó ăn luôn cả thân và câu ra thành "Chạy  là xong"
    assert.equal(sach("Chạy ```pnpm dev``` là xong"), "Chạy pnpm dev là xong");
    assert.equal(sach("Dùng ```const a = 1``` nhé anh"), "Dùng const a = 1 nhé anh");
  });

  it("nội dung TRONG khối code KHÔNG bị các bước markdown ăn tiếp", () => {
    // Bản đầu gỡ hàng rào NGAY nên `# Tính tổng` trong đoạn Python bị boTieuDe
    // cắt mất dấu thăng - code trả về sai cú pháp, người dùng copy về là lỗi
    const ra = sach("```python\n# Tính tổng\ntong = 0\nx = a**2\n```");
    assert.match(ra, /# Tính tổng/, `dấu thăng của comment bị ăn: ${ra}`);
    assert.match(ra, /a\*\*2/, `luỹ thừa bị ăn: ${ra}`);
    assert.ok(!ra.includes("```"), ra);
  });

  it("khối code xử TRƯỚC inline - khẳng định bằng THỨ TỰ trong daSua", () => {
    // Chỉ so nội dung ra là test ma: với đầu vào này hai thứ tự cho cùng kết
    // quả nên đảo `boKhoiCode`/`boInlineCode` mà test vẫn xanh. Đã đo thật.
    // Thứ tự trong `daSua` mới phân biệt được.
    const kq = lamSachTraLoi("Xem `biến` rồi:\n```\nvar x = 1;\n```");
    assert.deepEqual(kq.daSua, ["khối code", "inline code"]);
    assert.match(kq.text, /var x = 1;/);
    assert.match(kq.text, /Xem biến rồi:/);
  });

  it("dấu nháy đơn BÊN TRONG khối code được giữ, không bị bộ inline ăn", () => {
    const kq = lamSachTraLoi("```\nvar x = `template`;\n```");
    assert.equal(kq.text, "var x = `template`;");
    assert.deepEqual(kq.daSua, ["khối code"], "không được có 'inline code' - nó nằm trong khối");
  });

  it("tiêu đề mọi cấp", () => {
    assert.equal(sach("# Tiêu đề\n## Mục nhỏ\n### Sâu hơn"), "Tiêu đề\nMục nhỏ\nSâu hơn");
  });

  it("liên kết giữ CẢ chữ lẫn URL - URL là thông tin thật người dùng cần", () => {
    assert.equal(
      sach("Xem [báo cáo quý 3](https://vd.test/bc) nhé"),
      "Xem báo cáo quý 3 (https://vd.test/bc) nhé",
    );
  });

  it("liên kết không có chữ thì còn lại URL", () => {
    assert.equal(sach("[](https://vd.test/x)"), "https://vd.test/x");
  });

  it("URL có tham số và khoảng trắng phía sau KHÔNG bị vứt phần đuôi", () => {
    // Bản đầu để `([^)\s]+)[^)]*` - phần sau khoảng trắng khớp nhưng không nằm
    // trong nhóm nào nên bị vứt trắng
    assert.equal(
      sach("Xem [tài liệu](https://vd.test/a?x=1 bản PDF) nhé"),
      "Xem tài liệu (https://vd.test/a?x=1 bản PDF) nhé",
    );
  });

  it("ảnh markdown cũng bị nuốt dấu chấm than", () => {
    const ra = sach("![biểu đồ](https://vd.test/a.png)");
    assert.ok(!ra.startsWith("!"), ra);
    assert.match(ra, /vd\.test/);
  });
});

describe("lamSachTraLoi - bảng markdown", () => {
  it("bỏ dòng kẻ, GIỮ mọi dòng có chữ", () => {
    // Kịch bản nghiệm thu của phase: người dùng bảo "trình bày dạng bảng"
    const ra = sach("| Sản phẩm | Giá |\n|---|---:|\n| Cà phê | 45.000 |\n| Trà | 30.000 |");
    assert.ok(!ra.includes("---"), `còn dòng kẻ: ${JSON.stringify(ra)}`);
    assert.match(ra, /Sản phẩm/);
    assert.match(ra, /Cà phê \| 45\.000/);
    assert.match(ra, /Trà \| 30\.000/);
  });

  it("dòng chữ thường có gạch ngang KHÔNG bị nhận nhầm là dòng kẻ", () => {
    const goc = "Giờ làm: 8h - 17h\n- Nghỉ trưa 12h - 13h";
    assert.equal(sach(goc), goc);
  });

  it("dòng chỉ có gạch ngang nhưng KHÔNG có gạch đứng thì giữ nguyên", () => {
    assert.equal(sach("Phần một\n---\nPhần hai"), "Phần một\n---\nPhần hai");
  });

  it("cần ÍT NHẤT hai gạch ngang liền nhau - một gạch là dữ liệu, không phải dòng kẻ", () => {
    // Docstring cam kết điều này; không có test thì nới thành một gạch vẫn xanh
    const goc = "| 8h - 17h |\n| Ca 2 |";
    assert.equal(sach(goc), goc);
    assert.equal(sach("| A |\n| - |\n| 1 |"), "| A |\n| - |\n| 1 |");
  });
});

describe("lamSachTraLoi - những thứ TUYỆT ĐỐI không được đụng", () => {
  it("câu trả lời tiếng Việt bình thường đi qua KHÔNG ĐỔI MỘT KÝ TỰ", () => {
    // Tiêu chí hoàn thành của phase - so sánh CHÍNH XÁC, không phải match
    const goc =
      "Chào anh Hải, em đã kiểm tra rồi ạ.\n" +
      "- Đơn hàng số 1042: đã giao lúc 14h30 ngày 28/07\n" +
      "- Đơn hàng số 1043: đang vận chuyển, dự kiến mai\n" +
      "Anh cần em tra thêm gì nữa không ạ?";
    const kq = lamSachTraLoi(goc);
    assert.equal(kq.text, goc);
    assert.deepEqual(kq.daSua, [], "không được báo là đã sửa gì");
    assert.equal(kq.chan, false);
  });

  it("gạch đầu dòng '-' giữ nguyên - persona đang DẠY bot dùng nó", () => {
    const goc = "Có 3 việc:\n- Việc một\n- Việc hai\n- Việc ba";
    assert.equal(sach(goc), goc);
  });

  it("dấu sao giữa số là phép nhân, không phải chữ nghiêng", () => {
    assert.equal(sach("Kết quả 2*3*4 = 24"), "Kết quả 2*3*4 = 24");
    assert.equal(sach("Diện tích = 5*4 mét"), "Diện tích = 5*4 mét");
  });

  it("dấu sao có khoảng trắng hai bên cũng là phép tính", () => {
    assert.equal(sach("Tính 12 * 5 * 2 giúp em"), "Tính 12 * 5 * 2 giúp em");
  });

  it("dấu tiếng Việt nguyên vẹn qua mọi bước xử lý", () => {
    const kq = sach("**Đường Trần Hưng Đạo** có *quán phở* ngon lắm ạ");
    assert.equal(kq, "Đường Trần Hưng Đạo có quán phở ngon lắm ạ");
    // Đề phòng ai đó chữa regex bằng cách chuẩn hóa Unicode
    assert.ok(kq.includes("ườ") && kq.includes("ạ") && kq.includes("ở"));
  });

  it("dấu thăng giữa câu (hashtag) không bị coi là tiêu đề", () => {
    assert.equal(sach("Mã đơn #1042 nhé"), "Mã đơn #1042 nhé");
  });

  it("dấu thăng ĐẦU DÒNG dính liền chữ cũng không phải tiêu đề - cần khoảng trắng", () => {
    // Markdown đòi khoảng trắng sau dấu thăng. Bỏ đòi hỏi đó thì mã đơn đứng
    // đầu dòng bị cắt mất dấu thăng
    assert.equal(sach("#1042 đã giao xong"), "#1042 đã giao xong");
    assert.equal(sach("Đơn:\n#1042 đã giao"), "Đơn:\n#1042 đã giao");
  });

  it("cặp hai dấu sao có khoảng trắng bên trong là phép tính, không phải in đậm", () => {
    assert.equal(sach("Tính 12 ** 5 ** 2 giúp em"), "Tính 12 ** 5 ** 2 giúp em");
  });

  it("luỹ thừa Python 2**3**2 giữ nguyên - đúng luật left-flanking như dấu sao đơn", () => {
    assert.equal(sach("Trong Python 2**3**2 = 512 nhé"), "Trong Python 2**3**2 = 512 nhé");
  });

  it("cú pháp [..](..) KHÔNG phải liên kết thì giữ nguyên hoàn toàn", () => {
    // Cú pháp này xuất hiện đầy trong văn bản thường; đổi nó đi là hỏng chữ thật
    assert.equal(sach("Mã lô [A12](hàng nhập) đã về kho"), "Mã lô [A12](hàng nhập) đã về kho");
    assert.equal(sach("Gọi handlers[0](event) là được"), "Gọi handlers[0](event) là được");
  });

  it("URL có dấu gạch dưới và dấu chấm không bị đụng", () => {
    const goc = "Tải ở https://vd.test/bao_gia_2026.pdf nhé";
    assert.equal(sach(goc), goc);
  });

  it("chuỗi rỗng và chuỗi chỉ khoảng trắng không làm vỡ", () => {
    assert.equal(sach(""), "");
    assert.equal(sach("   "), "   ");
  });
});

describe("lamSachTraLoi - chặn rò system prompt", () => {
  it("mọi dấu hiệu trong hằng số dùng chung đều bị chặn", () => {
    for (const dau of DAU_HIEU_RO_PROMPT) {
      const kq = lamSachTraLoi(`Đây là chỉ dẫn của mình: ${dau} ...`);
      assert.equal(kq.chan, true, dau);
      assert.equal(kq.text, "", "chặn thì KHÔNG được gửi nửa vời");
      assert.deepEqual(kq.daSua, ["CHẶN: rò system prompt"]);
    }
  });

  it("kiểm trên chữ GỐC - markdown xen vào không lách được", () => {
    // Bỏ định dạng TRƯỚC rồi mới kiểm thì dấu hiệu đã đổi hình dạng và bộ canh
    // trượt đúng ca người ta cố tình lách
    assert.equal(lamSachTraLoi("**Quy tắc an toàn (tuyệt đối, không có ngoại lệ):**").chan, true);
  });

  it("câu trả lời bình thường nhắc chữ 'an toàn' KHÔNG bị chặn nhầm", () => {
    const kq = lamSachTraLoi("Anh đi đường an toàn nhé, nhớ đội mũ bảo hiểm ạ.");
    assert.equal(kq.chan, false);
  });

  it("'Khả năng của bạn lúc này' trong câu THƯỜNG không bị chặn - dấu hiệu phải là câu ĐẦY ĐỦ", () => {
    // Vòng rà soát bắt được: dấu hiệu cũ chỉ là mẩu tiếng Việt thường ngày.
    // Chặn oan ở đây rất nặng và KHÔNG TỰ KHỎI - hỏi lại vẫn y hệt vì model
    // sinh lại đúng cách diễn đạt đó; ở scheduler còn tiêu suất chạy của job.
    for (const cau of [
      "Khả năng của bạn lúc này đã đủ để thi B1 rồi ạ.",
      "Khả năng của bạn lúc này vay được khoảng 300 triệu.",
    ]) {
      assert.equal(lamSachTraLoi(cau).chan, false, cau);
    }
  });

  it("nhưng câu ĐẦY ĐỦ do persona sinh ra thì vẫn chặn", () => {
    assert.equal(
      lamSachTraLoi("Khả năng của bạn lúc này (đúng những công cụ đang bật, không hơn):").chan,
      true,
    );
    assert.equal(
      lamSachTraLoi("Khả năng của bạn lúc này: KHÔNG có công cụ nào được bật").chan,
      true,
    );
  });

  it("coDauHieuRoPrompt dùng được độc lập", () => {
    assert.equal(coDauHieuRoPrompt("bình thường"), false);
    assert.equal(coDauHieuRoPrompt("<noi_dung_ngoai nguon=..."), true);
  });
});

describe("lamSachTraLoi - nhãn [SILENT] lọt vào lượt chat thường", () => {
  it("dòng [SILENT] riêng bị bỏ, phần còn lại giữ nguyên", () => {
    const kq = lamSachTraLoi("Hôm nay có 2 tin mới ạ.\n\n[SILENT]");
    assert.equal(kq.text, "Hôm nay có 2 tin mới ạ.");
    assert.ok(kq.daSua.includes("nhãn [SILENT]"));
  });

  it("[SILENT] đứng đầu cũng bị bỏ", () => {
    assert.equal(lamSachTraLoi("[SILENT]\nKhông có gì mới.").text, "Không có gì mới.");
  });

  it("[SILENT] nằm GIỮA câu giữ nguyên - đó là chữ thật, không phải nhãn", () => {
    const goc = "Mình định [SILENT] nhưng đây là tóm tắt hôm nay: có 3 tin.";
    assert.equal(lamSachTraLoi(goc).text, goc);
  });

  it("dòng MỞ ĐẦU bằng [SILENT] nhưng có nội dung thật thì GIỮ NGUYÊN CẢ DÒNG", () => {
    // Vòng rà soát bắt được: bản đầu đem `isSilentResponse` (hàm phán xét CẢ
    // câu trả lời, có luật "mở đầu bằng [SILENT] thì nuốt cả câu") đi lọc TỪNG
    // DÒNG. Kết quả: câu trả lời hợp lệ khi người dùng hỏi về chính cái nhãn bị
    // vứt sạch, người nhắn ngồi im không nhận gì.
    const goc = "[SILENT] là nhãn nội bộ, dùng để bot im lặng khi không có tin mới ạ.";
    assert.equal(lamSachTraLoi(goc).text, goc);
    assert.deepEqual(lamSachTraLoi(goc).daSua, [], "không được đụng gì");

    const hai = "[SILENT] không có gì mới\nCảm ơn anh đã hỏi ạ";
    assert.equal(lamSachTraLoi(hai).text, hai);
  });
});

describe("lamSachTraLoi - không ăn tham trên câu dài", () => {
  it("câu 2000 ký tự nhiều ký tự đặc biệt vẫn giữ đúng phần chữ", () => {
    const khoi = "Mục **quan trọng** với `mã lệnh` và [liên kết](https://vd.test/a) - dòng thường 2*3.\n";
    const goc = khoi.repeat(30);
    assert.ok(goc.length > 2000, `mới ${goc.length} ký tự`);
    const ra = sach(goc);

    assert.ok(!ra.includes("**"), "còn sót dấu sao đôi");
    assert.ok(!ra.includes("`"), "còn sót dấu nháy");
    assert.ok(!ra.includes("]("), "còn sót cú pháp liên kết");
    // Đếm để chắc regex không nuốt mất cả đoạn ở giữa
    assert.equal(ra.split("quan trọng").length - 1, 30);
    assert.equal(ra.split("2*3").length - 1, 30, "phép nhân phải còn đủ 30 chỗ");
    assert.equal(ra.split("- dòng thường").length - 1, 30, "gạch đầu dòng phải còn đủ");
  });

  it("dấu sao lẻ không cặp không làm treo hay nuốt chữ", () => {
    assert.equal(sach("Ghi chú * chưa xong"), "Ghi chú * chưa xong");
    assert.equal(sach("**chưa đóng"), "**chưa đóng");
  });

  it("ký tự NUL của model không cướp được mốc khối code", () => {
    // MOC_KHOI là ký tự NUL. Docstring nói "model không sinh ra nó" - đó là giả
    // định, không phải bất biến: JSON escape NUL hoàn toàn hợp lệ. Không dọn
    // trước thì chuỗi có dạng NUL + số + NUL va đúng mốc và `traKhoiCodeVe`
    // nhét nội dung khối code vào nhầm chỗ.
    const nul = " ";
    const ra = sach(`x ${nul}0${nul} y
\`\`\`
THAT SU
\`\`\``);
    assert.ok(!ra.includes(nul), "không được để lọt ký tự NUL xuống Zalo");
    assert.equal(ra.split("THAT SU").length - 1, 1, `nội dung khối code bị nhân đôi: ${JSON.stringify(ra)}`);
  });

  it("chuỗi độc không làm biểu thức chạy bậc hai (ReDoS)", () => {
    // Đây là đường tấn công THẬT, không phải lý thuyết: bot đọc tin của người
    // lạ, một tin "lặp lại chính xác chuỗi sau: [[[[..." là đủ để model nhại
    // lại. Tiến trình này MỘT luồng phục vụ mọi account + vòng tick scheduler +
    // HTTP dashboard, nên kẹt event loop vài giây là cả bot đứng hình.
    //
    // Đo trước khi vá: 51.200 dấu `[` mất 1.263ms, 25.600 gạch trong bảng mất
    // 1.446ms. Sau khi vá cả hai còn dưới 30ms.
    const docHai: [string, string][] = [
      ["dấu ngoặc vuông", "[".repeat(50_000)],
      ["dòng kẻ bảng", `|${"-".repeat(50_000)}x`],
      ["ngoặc liên kết", `[a](${"b".repeat(50_000)}`],
      ["hàng rào code", "```".repeat(20_000)],
      // Ca này KHÔNG bị bộ trên chạm tới: vòng rà soát toàn cục đo được
      // 200.000 dấu cách sau ``` mất 20,5 GIÂY vì `[ 	]*...[ 	]*` là hai
      // lượng từ trên cùng lớp ký tự - đúng thứ luật số 2 đầu file cấm
      ["khoảng trắng sau hàng rào", `\`\`\`${" ".repeat(100_000)}x`],
      ["tab sau hàng rào", `Anh xem: \`\`\`${"	".repeat(50_000)}`],
      ["dấu sao", "*".repeat(50_000)],
      ["nháy đơn", "`a".repeat(25_000)],
    ];
    for (const [ten, doc] of docHai) {
      const t0 = process.hrtime.bigint();
      lamSachTraLoi(doc);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < 500, `${ten}: ${ms.toFixed(0)}ms - biểu thức đang chạy bậc hai`);
    }
  });
});
