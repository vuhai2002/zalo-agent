import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/regex) - không chạm env/DB nên import tĩnh được
import { docChuTuFile } from "./doc-text-extract.js";
import { renderDocx } from "../documents/render-docx.js";
import { docxChiCoAnh, docxTuXml, zipEntryQuaTran } from "./ooxml-zip-test-helper.js";

const wordTable = () =>
  fs.readFileSync(new URL("./fixtures/word-table.docx", import.meta.url));
const wordTabstop = () =>
  fs.readFileSync(new URL("./fixtures/word-tabstop.docx", import.meta.url));

describe("extract-docx-text (qua docChuTuFile)", () => {
  it("đọc lại được chữ từ chính file docx do bot sinh ra", async () => {
    const buf = await renderDocx(
      [{ type: "paragraph", text: "Đổi trả trong 7 ngày" }],
      { title: "Chính sách" },
    );
    const chu = await docChuTuFile(buf, "docx");
    assert.match(chu, /Đổi trả trong 7 ngày/);
  });

  it("tiêu đề văn bản (title) và heading đều đọc ra được", async () => {
    const buf = await renderDocx([
      { type: "heading", text: "Bảo hành", level: 1 },
      { type: "paragraph", text: "12 tháng kể từ ngày mua" },
    ]);
    const chu = await docChuTuFile(buf, "docx");
    assert.match(chu, /Bảo hành/);
    assert.match(chu, /12 tháng kể từ ngày mua/);
  });

  it("heading dịch sang markdown '#' để chunk-text nhận diện được tiêu đề", async () => {
    const buf = await renderDocx([
      { type: "heading", text: "Chính sách đổi trả", level: 2 },
      { type: "paragraph", text: "Trong vòng 7 ngày." },
    ]);
    const chu = await docChuTuFile(buf, "docx");
    assert.match(chu, /^##?\s+Chính sách đổi trả$/m);
  });

  it("nhiều đoạn văn giữ đúng thứ tự và nội dung", async () => {
    const buf = await renderDocx([
      { type: "paragraph", text: "Đoạn một" },
      { type: "paragraph", text: "Đoạn hai" },
    ]);
    const chu = await docChuTuFile(buf, "docx");
    assert.ok(chu.indexOf("Đoạn một") < chu.indexOf("Đoạn hai"));
  });

  it("file docx hỏng (không phải zip) ném lỗi tiếng Việt đọc được", async () => {
    await assert.rejects(
      () => docChuTuFile(Buffer.from("khong phai file zip"), "docx"),
      /không phải file zip/i,
    );
  });
});

describe("extract-docx-text - fixture Word THẬT (src/knowledge/fixtures)", () => {
  it("đọc file .docx do Word THẬT ghi, không lẫn một mẩu XML nào", async () => {
    const chu = await docChuTuFile(wordTable(), "docx");
    assert.doesNotMatch(chu, /<w:/, "XML thô lọt vào chữ trích ra");
    assert.match(chu, /chữ có khoảng trắng đầu dòng/);
  });

  it("tab stop trong Word không biến thành XML thô, tab thật vẫn ra ký tự tab", async () => {
    // Ca ĐÃ ĐO hỏng ở bản regex cũ: <w:tab w:val="left" w:pos="2880"/> khớp
    // nhầm /<w:t[^>]*>/ - toàn bộ định nghĩa tab stop lọt thẳng vào kết quả.
    const chu = await docChuTuFile(wordTabstop(), "docx");
    assert.doesNotMatch(chu, /w:val|w:pos|w:tabs/);
    // So khớp CHÍNH XÁC toàn bộ (không phải .match substring): fixture có
    // ĐÚNG 2 định nghĩa tab stop trong <w:pPr><w:tabs> (w:pos=2880 và 5760)
    // TRƯỚC 2 tab THẬT trong <w:r> - nếu tab-định-nghĩa lỡ bị tính thành ký
    // tự tab thì kết quả sẽ THỪA tab ở ĐẦU chuỗi, mà .match substring không
    // bắt được thừa đó (chuỗi con vẫn khớp). .equal() mới bắt được.
    assert.equal(chu, "Ca phe\tGia 25000\tBao hanh 12 thang");
  });

  it("bảng Word giữ cấu trúc hàng; <w:p/> tự đóng trong ô rỗng không gộp sai ranh giới đoạn", async () => {
    // Ca ĐÃ ĐO hỏng: PARAGRAPH_RE coi <w:p/> là thẻ MỞ (nuốt dấu "/") rồi
    // quét tới </w:p> kế tiếp - fixture có 2 <w:p/> tự đóng trong ô bảng rỗng
    // (hàng 2) và 1 cái nữa ở cuối body, đúng ca "bom hẹn giờ" nghiên cứu nêu.
    const chu = await docChuTuFile(wordTable(), "docx");
    assert.match(chu, /Tên \| Số/, `không thấy hàng bảng, đọc ra: ${JSON.stringify(chu)}`);
    // Hàng 2 toàn ô rỗng -> bị lọc bỏ (giống luật "bỏ hàng không có ô nào có
    // chữ" của xlsx) - không được để lại "| " hay dòng rỗng lạc lõng.
    assert.doesNotMatch(chu, /Tên \| Số\n\|/);
  });

  it("<w:p/> tự đóng NẰM GIỮA hai đoạn văn thật không gộp lẫn nội dung", async () => {
    // fixture word-table.docx không lộ được ca này: 3 <w:p/> tự đóng của nó
    // đều nằm ở CUỐI tài liệu, không còn </w:p> nào phía sau để bug cũ
    // (PARAGRAPH_RE quét lố sang </w:p> kế tiếp) gộp nhầm - đúng nhận định
    // "vô hại trong file đo được nhưng là bom hẹn giờ" của báo cáo nghiên
    // cứu. Test này đặt <w:p/> XEN GIỮA hai đoạn có chữ để lộ ra ranh giới.
    const chu = await docChuTuFile(
      docxTuXml(
        "<w:p><w:r><w:t>Truoc tu dong</w:t></w:r></w:p>" +
          '<w:p w:rsidR="1"/>' +
          "<w:p><w:r><w:t>Sau tu dong</w:t></w:r></w:p>",
      ),
      "docx",
    );
    assert.equal(chu, "Truoc tu dong\n\nSau tu dong");
  });
});

describe("extract-docx-text - bom và trần an toàn", () => {
  it("XML thiếu thẻ đóng bị từ chối trong dưới 1 giây, không quay CPU", async () => {
    const bom = docxTuXml("<w:p>".repeat(200_000)); // không có thẻ đóng nào
    const t0 = performance.now();
    await assert.rejects(() => docChuTuFile(bom, "docx"));
    const tonMs = performance.now() - t0;
    assert.ok(tonMs < 1000, `tốn ${tonMs}ms - phải dưới 1 giây (bản regex cũ tốn 38 090ms)`);
  });

  it("entry giải nén vượt trần bị từ chối, KHÔNG cấp phát hết", async () => {
    await assert.rejects(() => docChuTuFile(zipEntryQuaTran(), "docx"), /vượt quá giới hạn/i);
  });

  it("XML lồng sâu quá trần bị từ chối", async () => {
    await assert.rejects(
      () => docChuTuFile(docxTuXml("<w:p>".repeat(300) + "x"), "docx"),
      /lồng quá sâu/i,
    );
  });

  it("docx chỉ có ảnh (không có chữ nào) NÉM lỗi tiếng Việt đọc được", async () => {
    // Trả chuỗi rỗng thì worker đánh dấu "Sẵn sàng, 0 đoạn" - nguồn độc trông
    // như nguồn khỏe. Đây là cách nguồn giết tiến trình lọt qua nhánh "hong".
    await assert.rejects(() => docChuTuFile(docxChiCoAnh(), "docx"), /không đọc được chữ nào/i);
  });
});
