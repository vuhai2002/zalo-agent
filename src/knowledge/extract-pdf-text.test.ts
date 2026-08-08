import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng unpdf) - không chạm env/DB nên import tĩnh được
import { docChuTuFile } from "./doc-text-extract.js";

/**
 * PDF một trang tối thiểu, chữ ASCII. Truyền chuỗi rỗng thì ra trang KHÔNG có
 * toán tử vẽ chữ nào - đúng hình dạng của PDF quét ảnh nhìn từ phía trình đọc.
 * Bảng xref là ĐỘ LỆCH BYTE nên phải cộng dồn khi ghép, không ghi số cứng.
 */
function pdfMotTrang(chu: string): Buffer {
  const noiDungTrang = chu ? `BT /F1 12 Tf 72 720 Td (${chu}) Tj ET\n` : "";
  const obj = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${noiDungTrang.length}>>\nstream\n${noiDungTrang}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const lech: number[] = [];
  obj.forEach((than, i) => {
    lech.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${than}\nendobj\n`;
  });

  const lechXref = pdf.length;
  pdf += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n`;
  for (const v of lech) pdf += `${String(v).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${obj.length + 1}/Root 1 0 R>>\nstartxref\n${lechXref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1"); // latin1: 1 ký tự = 1 byte, độ lệch xref mới đúng
}

describe("extract-pdf-text (qua docChuTuFile)", () => {
  it("đọc được chữ từ PDF", async () => {
    const ra = await docChuTuFile(pdfMotTrang("Bao hanh 12 thang"), "pdf");
    assert.match(ra, /Bao hanh 12 thang/);
  });

  it("PDF hỏng thì ném lỗi có câu tiếng Việt đọc được, không ném lỗi thư viện thô", async () => {
    await assert.rejects(() => docChuTuFile(Buffer.from("khong phai pdf"), "pdf"), /không đọc được/i);
  });

  it("PDF không có lớp chữ (ảnh quét) báo ĐÚNG BỆNH, không báo chung chung", async () => {
    // `unpdf` trả chuỗi rỗng chứ không ném - nhánh này phải tự nhận ra
    await assert.rejects(() => docChuTuFile(pdfMotTrang(""), "pdf"), /ảnh quét/i);
  });
});
