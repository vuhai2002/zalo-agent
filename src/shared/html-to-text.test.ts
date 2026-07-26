import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractHtmlTitle, htmlToReadableText } from "./html-to-text.js";

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
