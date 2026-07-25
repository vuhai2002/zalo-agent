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
});

describe("extractHtmlTitle", () => {
  it("lấy title, bóc thẻ lồng trong title", () => {
    assert.equal(extractHtmlTitle("<title>Tin <b>nóng</b> hôm nay</title>"), "Tin nóng hôm nay");
    assert.equal(extractHtmlTitle("<p>không có title</p>"), "");
  });
});
