import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { taoPdfBomFlate, taoPdfNhieuTrang } from "../knowledge/fixtures/tao-pdf-thu-nghiem.js";
import { buildZipBuffer, docxTuXml } from "../knowledge/ooxml-zip-test-helper.js";
import { LoiTienTrinhConBiNgat, type TranTienTrinhCon } from "../shared/chay-tien-trinh-con-co-tran.js";
import { LoiTep } from "./attachment-extract-types.js";
import { taoCfb, taoDocToiThieu } from "./fixtures/tao-cfb-thu-nghiem.js";
import { trichXuatTep } from "./trich-xuat-tep.js";

const TRAN: TranTienTrinhCon = { hanMs: 60_000, tranRssMb: 400, tranHeapMb: 192 };
const goi = (buf: Buffer, duoiKhai: string, tranKyTu = 400_000) =>
  trichXuatTep(buf, { duoiKhai, tranKyTu, tranTrangPdf: 300, tran: TRAN });
const laLoiTep = (ma: string) => (err: unknown) => err instanceof LoiTep && err.ma === ma;

describe("trichXuatTep - đọc tệp chat trong tiến trình con", () => {
  it("docx -> một phần chữ", async () => {
    const kq = await goi(docxTuXml("<w:p><w:r><w:t>Biên bản bồi thường</w:t></w:r></w:p>"), "docx");
    assert.equal(kq.dinhDang, "docx");
    assert.equal(kq.phan.length, 1);
    assert.equal(kq.phan[0]!.nguon, "chu");
    assert.match(kq.phan[0]!.chu, /Biên bản bồi thường/);
  });

  it("xlsx 2 sheet -> 2 phần có thống kê; sheet ẩn hẳn bị bỏ và có cảnh báo", async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet("Tháng 3");
    a.addRow(["Ngày", "Số cây"]);
    a.addRow(["3/4", 95]);
    const b = wb.addWorksheet("Tháng 4");
    b.addRow(["Ngày", "Số cây"]);
    b.addRow(["4/1", 10]);
    const c = wb.addWorksheet("Ẩn");
    c.state = "veryHidden";
    c.addRow(["x"]);
    const kq = await goi(Buffer.from(await wb.xlsx.writeBuffer()), "xlsx");
    assert.equal(kq.dinhDang, "xlsx");
    assert.deepEqual(
      kq.phan.map((p) => [p.nhan, p.thongKe?.cot[0]?.tong]),
      [
        ['Sheet "Tháng 3"', 95],
        ['Sheet "Tháng 4"', 10],
      ],
    );
    assert.ok(kq.canhBao.some((c) => /1 sheet ẩn hẳn/.test(c)));
  });

  it("PDF chữ 3 trang -> 3 phần Trang 1..3, không trang nào cần OCR", async () => {
    const kq = await goi(taoPdfNhieuTrang(["Trang mot co chu day du de vuot nguong ba muoi", "Trang hai co chu day du de vuot nguong ba muoi", "Trang ba co chu day du de vuot nguong ba muoi"]), "pdf");
    assert.equal(kq.dinhDang, "pdf");
    assert.equal(kq.soTrang, 3);
    assert.deepEqual(
      kq.phan.map((p) => p.nhan),
      ["Trang 1", "Trang 2", "Trang 3"],
    );
    assert.deepEqual(kq.trangCanOcr, []);
  });

  it("PDF có trang không lớp chữ -> trang đó vào trangCanOcr", async () => {
    const kq = await goi(taoPdfNhieuTrang(["Trang mot co chu day du de vuot nguong ba muoi", ""]), "pdf");
    assert.deepEqual(kq.trangCanOcr, [2]);
  });

  it(".doc -> dinhDang doc", async () => {
    const kq = await goi(taoDocToiThieu("Mẫu 2B đánh giá"), "doc");
    assert.equal(kq.dinhDang, "doc");
    assert.match(kq.phan[0]!.chu, /Mẫu 2B đánh giá/);
  });

  it("PDF bom -> bị ngắt vuot-ram, không phải LoiTep", async () => {
    await assert.rejects(
      trichXuatTep(taoPdfBomFlate(256), { duoiKhai: "pdf", tranKyTu: 400_000, tranTrangPdf: 300, tran: { ...TRAN, tranRssMb: 160 } }),
      (err: unknown) => err instanceof LoiTienTrinhConBiNgat && err.lyDo === "vuot-ram",
    );
  });

  it("Office có mật khẩu -> mat-khau; zip thường -> chua-ho-tro", async () => {
    const maHoa = taoCfb([
      { ten: "EncryptionInfo", data: Buffer.alloc(10) },
      { ten: "EncryptedPackage", data: Buffer.alloc(10) },
    ]).buf;
    await assert.rejects(goi(maHoa, "xlsx"), laLoiTep("mat-khau"));
    await assert.rejects(goi(buildZipBuffer([{ name: "a.txt", data: Buffer.from("x") }]), "docx"), laLoiTep("chua-ho-tro"));
  });

  it("văn bản dài bị cắt ở tranKyTu và có cảnh báo", async () => {
    const kq = await goi(Buffer.from("á".repeat(5000), "utf-8"), "txt", 1000);
    const tong = kq.phan.reduce((n, p) => n + p.chu.length, 0);
    assert.equal(tong, 1000);
    assert.ok(kq.canhBao.some((c) => /cắt/.test(c)));
  });
});
