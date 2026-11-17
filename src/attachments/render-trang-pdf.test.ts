import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { taoPdfCoTrangAnh } from "../knowledge/fixtures/tao-pdf-thu-nghiem.js";
import type { TranTienTrinhCon } from "../shared/chay-tien-trinh-con-co-tran.js";
import { readImageSize } from "../zalo/zalo-image-variant.js";
import { renderTrangCanOcr, trichXuatTep } from "./trich-xuat-tep.js";

const TRAN: TranTienTrinhCon = { hanMs: 60_000, tranRssMb: 400, tranHeapMb: 192 };

async function jpegCoChu(): Promise<Buffer> {
  const c = createCanvas(600, 800);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 600, 800);
  g.fillStyle = "#000";
  g.font = "40px sans-serif";
  g.fillText("Xin chao OCR", 50, 100);
  return Buffer.from(await c.encode("jpeg", 90));
}

/** Tỉ lệ điểm ảnh tối của một ảnh JPEG - phân biệt trang trắng với trang có nội dung */
async function tiLeDiemToi(jpeg: Uint8Array): Promise<number> {
  const anh = await loadImage(Buffer.from(jpeg));
  const c = createCanvas(anh.width, anh.height);
  const g = c.getContext("2d");
  g.drawImage(anh, 0, 0);
  const { data } = g.getImageData(0, 0, anh.width, anh.height);
  let toi = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! < 300) toi++;
  return toi / (data.length / 4);
}

describe("OCR PDF quét - phân loại + render trang trong tiến trình con", () => {
  it("trang chỉ có ảnh vào trangCanOcr; render ra JPEG cạnh dài ~2000 px", async () => {
    const pdf = taoPdfCoTrangAnh("Trang mot co chu day du de vuot nguong ba muoi", await jpegCoChu(), 600, 800);
    const kq = await trichXuatTep(pdf, { duoiKhai: "pdf", tranKyTu: 400_000, tranTrangPdf: 300, tran: TRAN });
    assert.deepEqual(kq.trangCanOcr, [2]);
    assert.deepEqual(kq.phan.map((p) => p.nhan), ["Trang 1"]);

    const [anh] = await renderTrangCanOcr(pdf, [2], TRAN);
    assert.equal(anh!.so, 2);
    assert.equal(Buffer.from(anh!.jpeg).subarray(0, 2).toString("hex"), "ffd8");
    const co = readImageSize(Buffer.from(anh!.jpeg))!;
    const canhDai = Math.max(co.width, co.height);
    assert.ok(canhDai >= 1900 && canhDai <= 2100, `cạnh dài ${canhDai}`);
  });

  it("scan đen trắng nén CCITT G4 (ca unpdf 1.9.1 ra trang trắng) render có nội dung", async () => {
    const pdf = fs.readFileSync(new URL("./fixtures/mau-quet-ccitt.pdf", import.meta.url));
    const kq = await trichXuatTep(pdf, { duoiKhai: "pdf", tranKyTu: 400_000, tranTrangPdf: 300, tran: TRAN });
    assert.deepEqual(kq.trangCanOcr, [1]);
    const [anh] = await renderTrangCanOcr(pdf, [1], TRAN);
    const ti = await tiLeDiemToi(anh!.jpeg);
    assert.ok(ti > 0.01 && ti < 0.5, `tỉ lệ điểm tối ${ti} - trắng toàn bộ hoặc bị đảo màu`);
  });

  it("trang ít chữ vào trangCanOcr kể cả khi không thấy ảnh (pdf.js có thể đã bỏ ảnh quá lớn)", async () => {
    const { taoPdfNhieuTrang } = await import("../knowledge/fixtures/tao-pdf-thu-nghiem.js");
    const kq = await trichXuatTep(taoPdfNhieuTrang(["Trang mot co chu day du de vuot nguong ba muoi", ""]), {
      duoiKhai: "pdf",
      tranKyTu: 400_000,
      tranTrangPdf: 300,
      tran: TRAN,
    });
    assert.deepEqual(kq.trangCanOcr, [2]);
  });
});
