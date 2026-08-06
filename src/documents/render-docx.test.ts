import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ dùng thư viện docx) - không chạm env/DB nên import tĩnh được
import { renderDocx } from "./render-docx.js";
import { CONTENT_WIDTH_DXA } from "./render-docx-styles.js";
import { readZipEntryText, listZipEntries } from "../shared/read-zip-entry.js";
import type { DocumentBlock } from "./document-content-schema.js";

const documentXml = async (blocks: DocumentBlock[], title?: string) =>
  readZipEntryText(await renderDocx(blocks, { title }), "word/document.xml");

describe("renderDocx", () => {
  it("tạo file .docx hợp lệ (zip có đủ phần bắt buộc)", async () => {
    const buf = await renderDocx([{ type: "paragraph", text: "xin chào" }]);
    assert.equal(buf.subarray(0, 2).toString(), "PK", "file zip phải bắt đầu bằng PK");
    const entries = listZipEntries(buf);
    assert.ok(entries.includes("word/document.xml"), "thiếu document.xml");
    assert.ok(entries.includes("[Content_Types].xml"), "thiếu Content_Types");
  });

  it("giữ nguyên tiếng Việt có dấu", async () => {
    const xml = await documentXml([{ type: "paragraph", text: "Báo giá dịch vụ tháng 7" }]);
    assert.ok(xml.includes("Báo giá dịch vụ tháng 7"));
  });

  it("tiêu đề tài liệu + heading 3 cấp đều vào file", async () => {
    const xml = await documentXml(
      [
        { type: "heading", text: "Phần một", level: 1 },
        { type: "heading", text: "Phần hai", level: 2 },
        { type: "heading", text: "Phần ba", level: 3 },
      ],
      "Tiêu đề chính",
    );
    for (const text of ["Tiêu đề chính", "Phần một", "Phần hai", "Phần ba"]) {
      assert.ok(xml.includes(text), `thiếu "${text}"`);
    }
    // Khẳng định CẢ BA cấp: chỉ kiểm Heading1 với Heading2 thì một phép tra
    // ánh xạ cấp 3 về nhầm chỗ vẫn xanh, mà từ khi `level` là khoảng số thì
    // phép tra đó là hàm tự viết chứ không còn là bảng do trình biên dịch canh.
    for (const cap of [1, 2, 3]) {
      assert.ok(new RegExp(`Heading${cap}`).test(xml), `thiếu Heading${cap}`);
    }
  });

  it("bullets dùng numbering, KHÔNG chèn ký tự • vào text", async () => {
    const xml = await documentXml([{ type: "bullets", items: ["Giao trong 3 ngày", "Bảo hành 12 tháng"] }]);
    assert.ok(xml.includes("numPr"), "phải khai numbering để Word nhận là danh sách");
    assert.ok(xml.includes("Giao trong 3 ngày"));
    // Hồi quy gotcha: bullet thô trong <w:t> làm Word không thụt lề, không nối tiếp số
    assert.ok(!/<w:t[^>]*>•/.test(xml), "không được chèn • thẳng vào text");
  });

  it("bảng: dual width DXA + shading CLEAR + header lặp lại", async () => {
    const xml = await documentXml([
      {
        type: "table",
        headers: ["Sản phẩm", "Số lượng"],
        rows: [
          ["Bàn phím", "2"],
          ["Chuột", "3"],
        ],
      },
    ]);
    assert.ok(xml.includes("Bàn phím") && xml.includes("Chuột"));
    assert.ok(xml.includes('w:type="dxa"'), "chiều rộng phải là DXA (PERCENTAGE vỡ ở Google Docs)");
    assert.ok(xml.includes('w:val="clear"'), "shading phải CLEAR - SOLID render nền đen");
    assert.ok(!xml.includes('w:val="solid"'), "không được dùng shading SOLID");
    assert.ok(xml.includes("tblHeader"), "header nên lặp lại khi bảng tràn trang");
  });

  it("tổng bề rộng các cột khớp bề rộng vùng nội dung (lệch là Word render méo)", async () => {
    // 5 cột chia CONTENT_WIDTH có dư -> kiểm phần dư được dồn đúng
    for (const colCount of [3, 5, 7]) {
      const headers = Array.from({ length: colCount }, (_, i) => `Cột ${i + 1}`);
      const xml = await documentXml([{ type: "table", headers, rows: [headers.map(() => "x")] }]);
      const grid = xml.match(/<w:gridCol w:w="(\d+)"\s*\/>/g) ?? [];
      const total = grid.reduce((sum, g) => sum + Number(g.match(/\d+/)![0]), 0);
      assert.equal(total, CONTENT_WIDTH_DXA, `${colCount} cột: tổng phải khớp vùng nội dung`);
    }
  });

  it("typography chuẩn văn bản VN: Times New Roman, heading ĐEN không phải xanh theme", async () => {
    const buf = await renderDocx(
      [{ type: "heading", text: "Mục một", level: 1 }],
      { title: "KẾ HOẠCH" },
    );
    const styles = readZipEntryText(buf, "word/styles.xml");
    assert.ok(styles.includes("Times New Roman"), "font phải là Times New Roman");
    // Theme mặc định tô heading màu xanh accent (2E74B5/1F4E79...) - đã override đen
    assert.ok(!/(2E74B5|1F4E79|2F5496|4472C4)/i.test(styles), "heading không được dính màu xanh theme");
    const doc = readZipEntryText(buf, "word/document.xml");
    assert.ok(doc.includes("KẾ HOẠCH") && doc.includes("Mục một"));
  });

  it("lề trang chuẩn văn bản hành chính: trái 3cm (1701), phải 1.5cm (850)", async () => {
    const xml = await documentXml([{ type: "paragraph", text: "x" }]);
    assert.match(xml, /w:left="1701"/);
    assert.match(xml, /w:right="850"/);
  });

  it("marker **đậm** thành run bold, dấu sao không lọt vào text", async () => {
    const xml = await documentXml([
      { type: "paragraph", text: "**Thời gian:** từ 07h00 ngày 10/8" },
    ]);
    assert.ok(!xml.includes("**"), "dấu ** không được xuất hiện trong file");
    assert.ok(xml.includes("Thời gian:"), "phần đậm phải còn nguyên chữ");
    assert.ok(xml.includes("từ 07h00 ngày 10/8"));
    // Run chứa "Thời gian:" phải bold: <w:b/> đứng trước text đó trong cùng run
    assert.match(xml, /<w:b\/>.*?Thời gian:/s, "phần trong ** phải in đậm");
  });

  it("paragraph align right: canh phải và KHÔNG thụt đầu dòng (dòng lạc khoản)", async () => {
    const xml = await documentXml([
      { type: "paragraph", text: "Hà Nội, ngày 10 tháng 8 năm 2026", align: "right" },
      { type: "paragraph", text: "Đoạn văn xuôi bình thường trong văn bản." },
    ]);
    assert.match(xml, /w:val="right"/);
    // Đoạn justify có thụt đầu dòng, đoạn lạc khoản thì không
    assert.match(xml, /w:firstLine="567"/);
    const rightPara = xml.slice(xml.indexOf("Hà Nội") - 700, xml.indexOf("Hà Nội"));
    assert.ok(!rightPara.includes('w:firstLine'), "dòng canh phải không được thụt đầu dòng");
  });

  it("two_columns: bảng 2 cột KHÔNG viền cho quốc hiệu / khối ký tên", async () => {
    const xml = await documentXml([
      {
        type: "two_columns",
        left: ["UBND XÃ A", "**TRẠM Y TẾ**"],
        right: ["**CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM**", "**Độc lập - Tự do - Hạnh phúc**"],
      },
    ]);
    assert.ok(xml.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"));
    assert.ok(xml.includes("TRẠM Y TẾ"));
    // Bảng phải giấu viền: các cạnh khai none
    assert.match(xml, /w:val="none"/, "viền bảng two_columns phải là none");
    assert.ok(!xml.includes("**"), "marker đậm phải được parse, không lọt vào file");
  });

  it("bảng có đệm trong ô - chữ không dính sát viền", async () => {
    const xml = await documentXml([{ type: "table", headers: ["A"], rows: [["x"]] }]);
    // tblCellMar với lề trái/phải 108 twips
    assert.match(xml, /w:tblCellMar/, "bảng phải khai cell margin");
    assert.match(xml, /w:w="108"/);
  });

  it('đoạn văn có "\\n" bị tách thành nhiều Paragraph (docx bỏ qua ký tự xuống dòng)', async () => {
    const xml = await documentXml([{ type: "paragraph", text: "Dòng một\nDòng hai\n\nDòng ba" }]);
    assert.ok(xml.includes("Dòng một") && xml.includes("Dòng hai") && xml.includes("Dòng ba"));
    // 3 dòng có chữ -> ít nhất 3 <w:p>, và không có "\n" lọt vào text
    assert.ok(!/<w:t[^>]*>[^<]*\n/.test(xml), "không được để ký tự xuống dòng trong text");
  });

  it("nhiều block trộn lẫn vẫn ra đúng thứ tự", async () => {
    const xml = await documentXml([
      { type: "heading", text: "Mở đầu", level: 1 },
      { type: "paragraph", text: "Nội dung mở đầu" },
      { type: "bullets", items: ["Ý một"] },
      { type: "table", headers: ["A"], rows: [["B"]] },
    ]);
    const order = ["Mở đầu", "Nội dung mở đầu", "Ý một", "B"].map((t) => xml.indexOf(t));
    assert.ok(
      order.every((pos, i) => pos > 0 && (i === 0 || pos > order[i - 1]!)),
      "các block phải xuất hiện đúng thứ tự model gửi",
    );
  });
});
