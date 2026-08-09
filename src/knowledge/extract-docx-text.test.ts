import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/regex) - không chạm env/DB nên import tĩnh được
import { docChuTuFile } from "./doc-text-extract.js";
import { renderDocx } from "../documents/render-docx.js";
import { chuKhoNen, docxChiCoAnh, docxTuXml, zipEntryQuaTran } from "./ooxml-zip-test-helper.js";

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

  it("<w:p/> tự đóng NẰM GIỮA hai đoạn văn thật không gộp lẫn nội dung (chốt HỒI QUY, không phải bằng chứng B10-8)", async () => {
    // SỬA LẠI cách gọi test này sau rà soát: đây là chốt HỒI QUY cho ranh
    // giới đoạn văn khi có <w:p/> tự đóng xen giữa - KHÔNG PHẢI bằng chứng
    // B10-8 như báo cáo phase trước lỡ ghi. Đã kiểm tay: chạy PARAGRAPH_RE
    // (regex cũ) trên ĐÚNG input này cho ra "A\n\nB" - Y HỆT bản mới, vì thẻ
    // tự đóng không mang chữ nên không có gì để bug cũ làm mất. Bằng chứng
    // THẬT cho B10-8 (saxes phát cả moThe lẫn dongThe cho thẻ tự đóng) nằm ở
    // `xml-sax-scan.test.ts` ("thẻ tự đóng phát cả moThe LẪN dongThe").
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

  it("nội dung KHÔNG-KHOẢNG-TRẮNG trong pPr (bỏ qua nội dung) không lọt ra, không cần .trim() che", async () => {
    // Đo trực tiếp THE_BO_QUA_NOI_DUNG: bản test tab-stop ở trên KHÔNG chứng
    // minh được cơ chế này thật sự chặn nội dung - nó chỉ chứng minh trim()
    // xoá được KHOẢNG TRẮNG thừa ở đầu chuỗi (pPr luôn là con ĐẦU của <w:p>
    // theo schema, nên bất kỳ rò rỉ nào từ pPr luôn nằm ở đầu và bị trim()
    // nuốt, kể cả nếu chốt bỏ-qua-nội-dung hỏng hoàn toàn - đã kiểm tay bằng
    // cách tắt gate, test tab-stop ở trên VẪN xanh). <w:noBreakHyphen/> tạo
    // ra "-" - KHÔNG PHẢI khoảng trắng - nên nếu nó rò rỉ từ pPr thì trim()
    // KHÔNG xoá được, và test này mới thật sự đo được cơ chế bỏ-qua-nội-dung.
    // Đặt trong <w:pPr> là dữ liệu SAI SCHEMA có chủ đích (mô phỏng input đối
    // kháng), không phải file Word thật ghi.
    const chu = await docChuTuFile(
      docxTuXml("<w:p><w:pPr><w:noBreakHyphen/></w:pPr><w:r><w:t>Noi dung that</w:t></w:r></w:p>"),
      "docx",
    );
    assert.equal(chu, "Noi dung that", `dấu "-" không được lọt ra: ${JSON.stringify(chu)}`);
  });

  it("<w:instrText>/<w:delText> NẰM GIỮA hai run có chữ không lọt vào kết quả (không phải nhờ trim che)", async () => {
    // instrText/delText không nằm trong pPr/rPr (không được THE_BO_QUA_NOI_DUNG
    // che) - chúng bị loại vì CHỈ khớp đúng local name "t" mới được coi là nội
    // dung. Đặt GIỮA hai run có chữ thật để nếu cơ chế này hỏng (ví dụ ai đó
    // sau này đổi "ten === 't'" thành so khớp lỏng hơn), chữ rác sẽ lộ ra
    // GIỮA chuỗi - vị trí trim() không che được.
    const chu = await docChuTuFile(
      docxTuXml(
        "<w:p>" +
          "<w:r><w:t>Truoc</w:t></w:r>" +
          '<w:r><w:instrText> HYPERLINK "http://evil.example/x" </w:instrText></w:r>' +
          "<w:del><w:r><w:delText>chu da xoa</w:delText></w:r></w:del>" +
          "<w:r><w:t>Sau</w:t></w:r>" +
          "</w:p>",
      ),
      "docx",
    );
    assert.equal(chu, "TruocSau", `mã field/chữ đã xoá không được lọt vào giữa: ${JSON.stringify(chu)}`);
  });

  it("outlineLvl=9 (Body Text theo ECMA-376, KHÔNG phải heading) không biến đoạn văn thành tiêu đề", async () => {
    // Ca ĐÃ ĐO hỏng: Number("9") vẫn được nhận, ra "######### Doan thuong" -
    // đoạn văn thường bị chunk-text.ts coi là tiêu đề, gán sai ngữ cảnh cho
    // các chunk phía sau nó. outlineLvl hợp lệ cho heading chỉ 0-8.
    const chu = await docChuTuFile(
      docxTuXml(
        '<w:p><w:pPr><w:outlineLvl w:val="9"/></w:pPr><w:r><w:t>Doan thuong</w:t></w:r></w:p>',
      ),
      "docx",
    );
    assert.equal(chu, "Doan thuong", `không được có tiền tố "#": ${JSON.stringify(chu)}`);
  });

  it("bảng LỒNG trong ô không làm mất hàng bảng ngoài, không mất chữ trong ô", async () => {
    // Ca ĐÃ ĐO hỏng ở bản dùng biến đơn (không ngăn xếp): hàng "A1 | A2" của
    // bảng NGOÀI biến mất hoàn toàn (bảng lồng mở ra ghi đè hangCuaBang dùng
    // chung); chữ "B1" (đứng TRƯỚC bảng lồng, trong cùng ô) cũng mất; bảng
    // lồng thoát ra thành "đoạn" đứng SAI vị trí thay vì nằm trong ô của nó.
    // Kết quả SAI đã đo: "Truoc bang\n\nn1 | n2\n\nB1duoi\n\nn1 | n2\nn1 | n2 | n2 | B2\nC1 | C2\n\nSau bang".
    const oTc = (chu: string) => `<w:tc><w:p><w:r><w:t>${chu}</w:t></w:r></w:p></w:tc>`;
    const chu = await docChuTuFile(
      docxTuXml(
        "<w:tbl>" +
          `<w:tr>${oTc("A1")}${oTc("A2")}</w:tr>` +
          "<w:tr>" +
          "<w:tc>" +
          '<w:p><w:r><w:t>B1</w:t></w:r></w:p>' +
          `<w:tbl><w:tr>${oTc("n1")}${oTc("n2")}</w:tr></w:tbl>` +
          '<w:p><w:r><w:t>B1duoi</w:t></w:r></w:p>' +
          "</w:tc>" +
          oTc("B2") +
          "</w:tr>" +
          "</w:tbl>",
      ),
      "docx",
    );
    assert.match(chu, /A1 \| A2/, `mất hàng bảng ngoài: ${JSON.stringify(chu)}`);
    assert.match(chu, /\bB1\b/, `mất chữ trong ô trước bảng lồng: ${JSON.stringify(chu)}`);
    assert.match(chu, /n1 \| n2/, `mất nội dung bảng lồng: ${JSON.stringify(chu)}`);
    assert.match(chu, /B1duoi/, `mất chữ trong ô sau bảng lồng: ${JSON.stringify(chu)}`);
    assert.match(chu, /B2/, `mất ô còn lại của hàng ngoài: ${JSON.stringify(chu)}`);
    // Đúng thứ tự: hàng ngoài A1|A2 phải đứng TRƯỚC nội dung ô B (không bị
    // bảng lồng đẩy văng ra một "đoạn" tách rời đứng lạc chỗ).
    assert.ok(chu.indexOf("A1 | A2") < chu.indexOf("n1 | n2"));
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

  it("chữ trích ra vượt trần 8 MB bị từ chối với thông báo ĐÚNG NGHĨA, KHÔNG bị dán nhãn sai 'XML không hợp lệ'", async () => {
    // TRAN_TONG_KY_TU_TRICH TRƯỚC ĐÂY không có MỘT test nào (đường sống mà
    // người rà soát phải tự dựng mới biết chạy). Lỗi của nó cũng bị
    // xml-sax-scan.ts bọc nhầm thành "XML không hợp lệ: Chữ trích ra..." dù
    // file HOÀN TOÀN hợp lệ (chỉ là quá nhiều chữ) - handler ném ĐỒNG BỘ bên
    // trong parser.write() nên đi qua đúng nhánh dịch lỗi saxes. Dùng chữ khó
    // nén (không phải "x" lặp) để KHÔNG chạm trần tỉ lệ nén trước.
    const buf = docxTuXml(`<w:p><w:r><w:t>${chuKhoNen(8.5 * 1024 * 1024)}</w:t></w:r></w:p>`);
    await assert.rejects(() => docChuTuFile(buf, "docx"), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /vượt quá giới hạn 8 MB/i);
      assert.doesNotMatch(err.message, /XML không hợp lệ/i, "không được dán nhãn sai là lỗi cú pháp XML");
      return true;
    });
  });
});
