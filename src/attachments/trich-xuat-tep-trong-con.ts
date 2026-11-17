import { extractDocxText } from "../knowledge/extract-docx-text.js";
import { docTrangPdf, LoiDocPdf } from "../knowledge/extract-pdf-text.js";
import { extractXlsxSheets } from "../knowledge/extract-xlsx-sheets.js";
import { LoiVuotTran } from "../knowledge/ooxml-limits.js";
import { LoiTep, type KetQuaTrichXuatTep, type PhanNoiDung } from "./attachment-extract-types.js";
import { extractDocText } from "./extract-doc-text.js";
import { phanLoaiTrang } from "./phan-loai-trang-pdf.js";
import { giaiMaVanBan, nhanDienDinhDang } from "./nhan-dien-dinh-dang-tep.js";
import { thongKeSheet } from "./thong-ke-sheet.js";

/**
 * Phần việc chạy TRONG tiến trình con đọc tệp: nhận diện bằng byte rồi gọi
 * đúng bộ đọc. Module THUẦN - không env/DB/logger (xem `phucVuTienTrinhCon`).
 *
 * Mọi lỗi nội dung ra ngoài đều là `LoiTep` có MÃ - phía cha rẽ nhánh bằng mã,
 * không bằng chữ. Lỗi lạ của thư viện thành `hong`; câu lỗi mở đầu bằng tiếng
 * Việt, có thể kèm chi tiết gốc (tiếng Anh) của thư viện để chẩn đoán.
 */

export type DuLieuTrichXuat = { buf: Buffer; duoiKhai: string; tranKyTu: number; tranTrangPdf: number };

/** Excel giới hạn tên sheet 31 ký tự; tệp tự dựng thì không - chặn ở mức rộng hơn */
const TRAN_TEN_SHEET = 100;

function catTheoTran(phan: PhanNoiDung[], tranKyTu: number, canhBao: string[]): PhanNoiDung[] {
  let conLai = tranKyTu;
  const ra: PhanNoiDung[] = [];
  for (const p of phan) {
    if (conLai <= 0) break;
    if (p.chu.length > conLai) {
      ra.push({ ...p, chu: p.chu.slice(0, conLai) });
      canhBao.push(`Đã cắt: tệp dài hơn ${tranKyTu.toLocaleString("vi-VN")} ký tự, chỉ đọc phần đầu`);
      return ra;
    }
    conLai -= p.chu.length;
    ra.push(p);
  }
  if (ra.length < phan.length) canhBao.push(`Đã cắt: tệp dài hơn ${tranKyTu.toLocaleString("vi-VN")} ký tự, chỉ đọc phần đầu`);
  return ra;
}

async function docTheoLoai(d: DuLieuTrichXuat): Promise<KetQuaTrichXuatTep> {
  // View, không sao chép - xem `moPdf`
  const buf = Buffer.from(d.buf.buffer, d.buf.byteOffset, d.buf.byteLength);
  const loai = nhanDienDinhDang(buf, d.duoiKhai);
  const canhBao: string[] = [];
  const ket = (kq: Omit<KetQuaTrichXuatTep, "canhBao" | "trangCanOcr"> & { trangCanOcr?: number[] }) => ({
    trangCanOcr: [],
    ...kq,
    phan: catTheoTran(kq.phan, d.tranKyTu, canhBao),
    canhBao,
  });

  switch (loai) {
    case "pdf": {
      const pdf = await docTrangPdf(buf, { tranTrang: d.tranTrangPdf, tranKyTu: d.tranKyTu, phanLoai: true });
      if (pdf.catBot) canhBao.push(`Đã cắt: chỉ đọc ${pdf.trang.length}/${pdf.soTrang} trang đầu`);
      const loai = new Map((pdf.thongTin ?? []).map((t) => [t.so, phanLoaiTrang(t)]));
      return ket({
        dinhDang: "pdf",
        soTrang: pdf.soTrang,
        phan: pdf.trang
          .filter((t) => loai.get(t.so) === "chu")
          .map((t) => ({ nhan: `Trang ${t.so}`, chu: t.chu, nguon: "chu" })),
        trangCanOcr: pdf.trang.filter((t) => loai.get(t.so) === "ocr").map((t) => t.so),
      });
    }
    case "docx":
      return ket({ dinhDang: "docx", phan: [{ nhan: "Toàn văn", chu: await extractDocxText(buf), nguon: "chu" }] });
    case "xlsx": {
      const sheets = await extractXlsxSheets(buf);
      const soAnHan = sheets.filter((s) => s.hienThi === "an-han").length;
      if (soAnHan > 0) canhBao.push(`Đã bỏ ${soAnHan} sheet ẩn hẳn (người dùng Excel không mở ra được)`);
      const phan = sheets
        .filter((s) => s.hienThi !== "an-han" && s.hang.length > 0)
        .map<PhanNoiDung>((s) => ({
          nhan: `Sheet ${JSON.stringify(s.ten.slice(0, TRAN_TEN_SHEET))}${s.hienThi === "an" ? " (ẩn)" : ""}`,
          chu: s.hang.map((h) => h.map((o) => o.giaTri).join("\t")).join("\n"),
          nguon: "chu",
          thongKe: thongKeSheet(s),
        }));
      return ket({ dinhDang: "xlsx", phan });
    }
    case "cfb":
      // `extractDocText` tự kiểm cấu trúc + mật khẩu + có phải Word không
      return ket({ dinhDang: "doc", phan: [{ nhan: "Toàn văn", chu: await extractDocText(buf), nguon: "chu" }] });
    case "van-ban":
      return ket({ dinhDang: "van-ban", phan: [{ nhan: "Toàn văn", chu: giaiMaVanBan(buf), nguon: "chu" }] });
    case "anh":
      return ket({ dinhDang: "anh", phan: [] });
    default:
      throw new LoiTep("chua-ho-tro", "Chưa đọc được loại tệp này (đọc được: pdf, docx, doc, xlsx, txt, csv, md)");
  }
}

export async function trichXuatTepTrongCon(d: DuLieuTrichXuat): Promise<KetQuaTrichXuatTep> {
  try {
    return await docTheoLoai(d);
  } catch (err) {
    if (err instanceof LoiTep) throw err;
    if (err instanceof LoiDocPdf) throw new LoiTep(err.ma, err.message);
    if (err instanceof LoiVuotTran) throw new LoiTep("qua-lon", err.message);
    const chiTiet = err instanceof Error ? err.message : String(err);
    throw new LoiTep("hong", `Tệp bị hỏng, không đọc được: ${chiTiet}`);
  }
}
