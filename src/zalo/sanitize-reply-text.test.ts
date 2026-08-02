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

  it("khối code chứa dấu nháy đơn bên trong không bị cắt loạn", () => {
    // Đây là lý do phải xử KHỐI trước INLINE: làm ngược lại thì cặp nháy đơn
    // bên trong khối bị bộ inline ăn trước, phần còn lại thành nháy lẻ
    const ra = sach("```\nvar x = `template`;\n```");
    assert.match(ra, /var x = `template`;|var x = template;/);
    assert.ok(!ra.includes("```"), ra);
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
});
