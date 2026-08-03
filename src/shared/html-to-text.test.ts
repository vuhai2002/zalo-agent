import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractHtmlTitle, htmlToReadableText, stripHtmlTags } from "./html-to-text.js";

// Module thuần (chỉ kéo theo html-entities) nên import tĩnh được, không cần
// setupTestEnv. Giữ được điều đó là lý do stripHtmlTags nằm ở đây chứ không ở
// web-search-providers.ts.

describe("stripHtmlTags", () => {
  it("bỏ thẻ, giải entity số (giữ dấu tiếng Việt), gộp khoảng trắng", () => {
    // &#225; = á, &#224; = à - entity số hay gặp trong kết quả DDG tiếng Việt
    assert.equal(
      stripHtmlTags("<b>Gi&#225;\n  v&#224;ng</b> h&#244;m nay &amp; mai"),
      "Giá vàng hôm nay & mai",
    );
    assert.equal(stripHtmlTags("&quot;t&#7889;t&quot; &#39;ok&#39;"), "\"tốt\" 'ok'");
  });
});

describe("htmlToReadableText", () => {
  it("bỏ script/style/nav, giữ nội dung chính theo dòng", () => {
    const html = `<html><head><title>Trang</title><style>.a{color:red}</style></head>
      <body>
        <nav><a href="/">Menu rác</a></nav>
        <script>alert("xss")</script>
        <h1>Tiêu đề bài</h1>
        <p>Đoạn một có <b>chữ đậm</b>.</p>
        <p>Đoạn hai.</p>
        <footer>Bản quyền</footer>
      </body></html>`;
    const text = htmlToReadableText(html);

    assert.ok(!text.includes("alert"), "script phải bị bỏ");
    assert.ok(!text.includes("color:red"), "style phải bị bỏ");
    assert.ok(!text.includes("Menu rác"), "nav phải bị bỏ");
    assert.ok(!text.includes("Bản quyền"), "footer phải bị bỏ");
    assert.deepEqual(text.split("\n"), ["Tiêu đề bài", "Đoạn một có chữ đậm.", "Đoạn hai."]);
  });

  it("thẻ li thành gạch đầu dòng", () => {
    const text = htmlToReadableText("<ul><li>Một</li><li>Hai</li></ul>");
    assert.deepEqual(text.split("\n"), ["- Một", "- Hai"]);
  });

  it("HTML rỗng/toàn rác trả chuỗi rỗng, không throw", () => {
    assert.equal(htmlToReadableText("<script>x</script>"), "");
    assert.equal(htmlToReadableText(""), "");
  });

  it("list menu (chữ nằm hết trong link) bị vứt, list nội dung thật được giữ", () => {
    const html = `
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/mien-nam">Miền Nam</a></li>
        <li><a href="/mien-bac">Miền Bắc</a></li>
        <li><a href="/truc-tiep">Trực Tiếp Xổ Số</a></li>
      </ul>
      <p>Kết quả kỳ quay 19/07.</p>
      <ul>
        <li>Giải đặc biệt quay lúc 16h15 mỗi ngày</li>
        <li>Đối chiếu tại <a href="/so-ket-qua">sổ kết quả</a> trong 30 ngày</li>
      </ul>`;
    const text = htmlToReadableText(html);

    assert.ok(!text.includes("Home"), "menu điều hướng phải bị vứt");
    assert.ok(!text.includes("Miền Nam"));
    assert.ok(text.includes("Kết quả kỳ quay 19/07."));
    assert.ok(text.includes("- Giải đặc biệt quay lúc 16h15 mỗi ngày"), "list nội dung phải còn");
    assert.ok(text.includes("sổ kết quả"), "link nằm trong câu văn không bị tính là menu");
  });

  it("menu lồng menu con vẫn bị gỡ sạch qua nhiều lượt", () => {
    const html = `
      <ul><li><a href="/">Trang chủ</a>
        <ul><li><a href="/a">Mục A</a></li><li><a href="/b">Mục B</a></li><li><a href="/c">Mục C</a></li></ul>
      </li><li><a href="/x">Mục X</a></li><li><a href="/y">Mục Y</a></li></ul>
      <p>Nội dung thật.</p>`;
    const text = htmlToReadableText(html);
    assert.ok(!text.includes("Mục A") && !text.includes("Mục X"), "menu lồng phải bị gỡ hết");
    assert.equal(text, "Nội dung thật.");
  });

  it("form/select/header bị bỏ (khối 'Ngày: Tỉnh: Vé Số:' kiểu trang dò vé)", () => {
    const html = `
      <header><h1>Logo to đùng</h1></header>
      <form>Ngày: <select><option>19/07</option><option>18/07</option></select> Tỉnh: Đà Lạt</form>
      <p>Bảng kết quả ở đây.</p>`;
    const text = htmlToReadableText(html);
    assert.ok(!text.includes("Logo"), "header phải bị bỏ nhưng head vẫn xử lý riêng");
    assert.ok(!text.includes("Ngày:"), "form phải bị bỏ");
    assert.ok(!text.includes("19/07</option>") && !text.includes("18/07"), "option phải bị bỏ");
    assert.equal(text, "Bảng kết quả ở đây.");
  });

  it("bảng: ô cùng hàng ngăn bằng ' | ' để số không dính liền nhau", () => {
    const html = `<table>
      <tr><td>Giải đặc biệt</td><td>123456</td></tr>
      <tr><td>Giải nhất</td><td>65432</td></tr>
    </table>`;
    const text = htmlToReadableText(html);
    assert.ok(text.includes("Giải đặc biệt | 123456"), `thiếu ngăn cách cột: ${text}`);
    assert.ok(text.includes("Giải nhất | 65432"));
  });

  it("entity tên trong nội dung được giải mã (CHUY&Ecirc;N -> CHUYÊN)", () => {
    assert.equal(htmlToReadableText("<p>CHUY&Ecirc;N TRANG KẾT QUẢ</p>"), "CHUYÊN TRANG KẾT QUẢ");
  });

  it("số trong các span liền kề không dính chùm (markup kiểu xoso.com.vn)", () => {
    // Site bọc mỗi con số kết quả trong 1 span - bóc thẻ trần ra "36910..." vô dụng
    const html = "<div><span>36</span><span>910</span><span>4644</span> <span>6422</span></div>";
    assert.equal(htmlToReadableText(html), "36 910 4644 6422");
  });

  it("bảng HTML5 bỏ thẻ đóng </td></tr> vẫn tách được hàng và cột", () => {
    // Đúng markup thật của xoso.com.vn: <tr><td>8<td><span>36</span><tr>...
    const html =
      "<table><tr><td class=name-prize>8<td><span data-loto=36>36</span>" +
      "<tr><td class=name-prize>7<td><span data-loto=910>910</span>" +
      "<tr><td class=name-prize>ĐB<td><span data-loto=087842>087842</span></table>";
    const text = htmlToReadableText(html);
    assert.ok(!text.includes("836"), `hàng phải tách, không dính "8"+"36": ${text}`);
    assert.ok(/8\s*\|\s*36/.test(text), `thiếu ranh giới cột hàng G8: ${text}`);
    assert.ok(/ĐB\s*\|\s*087842/.test(text), `thiếu ranh giới cột hàng ĐB: ${text}`);
  });

  it("span đơn giữa từ không bị chẻ đôi", () => {
    assert.equal(htmlToReadableText("<p>Gi<span>á</span> vàng</p>"), "Giá vàng");
  });

  it("thẻ viết tràn nhiều dòng vẫn bị bóc (markup thật của tuoitre.vn)", () => {
    // Bóc thẻ chạy trên TỪNG DÒNG nên thẻ xuống dòng giữa chừng từng lọt nguyên
    // markup vào text gửi cho model
    const html = `<div><input onfocus="this.removeAttribute('readonly');" class="input-search"
placeholder="Nhập nội dung cần tìm" />
<p>Giá vàng hôm nay tăng</p></div>`;
    const text = htmlToReadableText(html);
    assert.ok(!text.includes("<input"), `còn markup trong text: ${text}`);
    assert.ok(!text.includes("placeholder"), `còn thuộc tính trong text: ${text}`);
    assert.ok(text.includes("Giá vàng hôm nay tăng"));
  });

  it("thẻ block xuống dòng giữa chừng vẫn tách được đoạn", () => {
    const html = `<p\nclass="intro">Đoạn một</p>\n<p>Đoạn hai</p>`;
    assert.equal(htmlToReadableText(html), "Đoạn một\nĐoạn hai");
  });

  it("dấu nhỏ hơn trong văn xuôi không bị nhận nhầm là thẻ", () => {
    assert.equal(htmlToReadableText("<p>Giá vàng < 100 triệu là mua được</p>"), "Giá vàng < 100 triệu là mua được");
  });
});

describe("extractHtmlTitle", () => {
  it("lấy title, bóc thẻ lồng trong title", () => {
    assert.equal(extractHtmlTitle("<title>Tin <b>nóng</b> hôm nay</title>"), "Tin nóng hôm nay");
    assert.equal(extractHtmlTitle("<p>không có title</p>"), "");
  });
});

describe("boMoiTheKhongNoiDung - tuyến tính, không ReDoS", () => {
  it("trang 3 MB toàn thẻ mở KHÔNG đóng phải xong dưới 1 giây", () => {
    // Đây là đường tấn công THẬT: người lạ gửi link trỏ về server của họ, model
    // gọi web_fetch, `MAX_HTML_BYTES` cho tới 3 MB. Tiến trình một luồng phục vụ
    // mọi account + tick scheduler + HTTP dashboard.
    //
    // Bản regex `<(script|...)\b[\s\S]*?<\/\1\s*>` đo được: 256 KB = 474 ms,
    // 1 MB = 7,1 giây, 3 MB = 63,3 GIÂY. Sau khi đổi sang quét tuyến tính: 73 ms.
    const don = "<script>" + "a".repeat(50);
    const html = don.repeat(Math.floor((3 * 1024 * 1024) / don.length));

    const t0 = process.hrtime.bigint();
    htmlToReadableText(html);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, `${ms.toFixed(0)}ms - thuật toán đang chạy bậc hai`);
  });

  it("tuyến tính: gấp đôi đầu vào thì KHÔNG gấp bốn thời gian", () => {
    const don = "<style>" + "b".repeat(40);
    const do1 = (n: number) => {
      const html = don.repeat(Math.floor(n / don.length));
      const t0 = process.hrtime.bigint();
      htmlToReadableText(html);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    // Lấy MIN của nhiều vòng chứ không đo một phát: nhiễu (GC, scheduler) chỉ
    // cộng thêm thời gian chứ không bao giờ trừ đi, nên min là số đo sạch nhất.
    // Đo một phát từng bị đỏ oan - tỉ số thật 1,9-2,3x nhưng một lần xui lên 3,3x.
    const minCua = (n: number) => Math.min(...Array.from({ length: 5 }, () => do1(n)));

    do1(200_000); // làm nóng, bỏ số đo đầu
    const nho = minCua(400_000);
    const to = minCua(800_000);
    // Tuyến tính ~2x, bậc hai ~4x, bản regex cũ đo được ~15x.
    assert.ok(to / nho < 3, `gấp đôi đầu vào -> gấp ${(to / nho).toFixed(1)} lần thời gian`);
  });
});

describe("boMoiTheKhongNoiDung - hành vi giữ nguyên như bản regex", () => {
  it("bỏ thẻ và toàn bộ nội dung bên trong", () => {
    const ra = htmlToReadableText("<p>Giữ lại</p><script>var x = 1;</script><p>Cũng giữ</p>");
    assert.match(ra, /Giữ lại/);
    assert.match(ra, /Cũng giữ/);
    assert.ok(!ra.includes("var x"), ra);
  });

  it("<header> KHÔNG bị nhận nhầm thành <head> - đúng bẫy mà thứ tự trong regex cũ né", () => {
    // Regex cũ dựa vào thứ tự alternation "header|head"; bản mới kiểm ký tự
    // ngay sau tên thẻ. Cả hai phải cho cùng kết quả.
    const ra = htmlToReadableText("<header>Menu trên</header><p>Nội dung thật</p>");
    assert.match(ra, /Nội dung thật/);
    assert.ok(!ra.includes("Menu trên"), ra);
  });

  it("thẻ mở KHÔNG có thẻ đóng thì giữ phần chữ, không nuốt cả trang", () => {
    // Thiên về giữ nhầm hơn xóa nhầm - cùng hướng an toàn với removeLinkDenseLists
    const ra = htmlToReadableText("<p>Trước</p><script>chưa đóng<p>Sau vẫn phải còn</p>");
    assert.match(ra, /Trước/);
    assert.match(ra, /Sau vẫn phải còn/);
  });

  it("nhiều thẻ cùng loại, có thẻ đóng đầy đủ", () => {
    const ra = htmlToReadableText("<p>A</p><nav>menu1</nav><p>B</p><nav>menu2</nav><p>C</p>");
    assert.match(ra, /A/);
    assert.match(ra, /B/);
    assert.match(ra, /C/);
    assert.ok(!ra.includes("menu1") && !ra.includes("menu2"), ra);
  });

  it("thẻ đóng viết hoa và có khoảng trắng", () => {
    const ra = htmlToReadableText("<p>Giữ</p><SCRIPT>bỏ đi</SCRIPT >");
    assert.match(ra, /Giữ/);
    assert.ok(!ra.includes("bỏ đi"), ra);
  });
});
