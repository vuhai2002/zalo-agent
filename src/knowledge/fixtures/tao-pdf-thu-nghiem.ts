import zlib from "node:zlib";

/**
 * Dựng PDF tối thiểu cho test - CHỈ dùng trong test.
 *
 * Bảng xref là ĐỘ LỆCH BYTE nên phải cộng dồn khi ghép; ghép bằng Buffer để
 * luồng nén nhị phân không bị đổi byte.
 */
function ghepPdf(cacDoiTuong: (string | Buffer)[]): Buffer {
  const phan: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let dai = phan[0]!.length;
  const lech: number[] = [];
  cacDoiTuong.forEach((than, i) => {
    lech.push(dai);
    const b = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      typeof than === "string" ? Buffer.from(than, "latin1") : than,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    phan.push(b);
    dai += b.length;
  });
  let xref = `xref\n0 ${cacDoiTuong.length + 1}\n0000000000 65535 f \n`;
  for (const v of lech) xref += `${String(v).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<</Size ${cacDoiTuong.length + 1}/Root 1 0 R>>\nstartxref\n${dai}\n%%EOF\n`;
  phan.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(phan);
}

function luongNoiDung(noiDung: Buffer, nen: boolean): Buffer {
  const du = nen ? zlib.deflateSync(noiDung, { level: 9 }) : noiDung;
  const loc = nen ? "/Filter/FlateDecode" : "";
  return Buffer.concat([Buffer.from(`<</Length ${du.length}${loc}>>\nstream\n`, "latin1"), du, Buffer.from("\nendstream", "latin1")]);
}

/**
 * PDF có `chuMoiTrang.length` trang, mỗi trang một dòng chữ ASCII (chuỗi rỗng
 * = trang không có lớp chữ, giống trang quét nhìn từ phía trình đọc).
 */
export function taoPdfNhieuTrang(chuMoiTrang: string[]): Buffer {
  const n = chuMoiTrang.length;
  // 1 catalog, 2 pages, 3 font, rồi mỗi trang 2 đối tượng (page + content)
  const kids = chuMoiTrang.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  const dt: (string | Buffer)[] = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${kids}]/Count ${n}>>`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  chuMoiTrang.forEach((chu, i) => {
    dt.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R>>>>/Contents ${5 + i * 2} 0 R>>`);
    const ve = chu ? `BT /F1 12 Tf 72 720 Td (${chu}) Tj ET\n` : "";
    dt.push(luongNoiDung(Buffer.from(ve, "latin1"), false));
  });
  return ghepPdf(dt);
}

/**
 * PDF một trang mà luồng nội dung là bom Flate: vài trăm KB nén, giải ra
 * `mbSauGiaiNen` MB khoảng trắng. Đo thật: 128 KB -> 385 MB ArrayBuffer khi
 * pdf.js đọc chữ - bộ nhớ NGOÀI heap, không cầu dao heap nào chặn được.
 */
export function taoPdfBomFlate(mbSauGiaiNen: number): Buffer {
  const than = Buffer.concat([
    Buffer.from("BT /F1 12 Tf 10 10 Td (hello) Tj ET\n", "latin1"),
    Buffer.alloc(mbSauGiaiNen * 1024 * 1024, 0x20),
  ]);
  return ghepPdf([
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    luongNoiDung(than, true),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]);
}
