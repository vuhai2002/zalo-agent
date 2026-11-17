import { LoiTienTrinhConBiNgat } from "../shared/chay-tien-trinh-con-co-tran.js";
import type { HourlyRateLimit } from "../shared/hourly-rate-limit.js";
import type { AnhTrang } from "./render-trang-pdf.js";

/**
 * Điều phối OCR nhiều trang PDF quét: trừ suất theo người gửi -> render JPEG
 * trong tiến trình con -> model đọc ảnh chép chữ, `songSong` trang mỗi lúc.
 *
 * Module THUẦN: mọi phụ thuộc truyền vào (render, chép, bộ đếm giờ) để test
 * không chạm mạng/DB và để phía gọi tự nối cấu hình thật.
 *
 * Suất tính theo trang THẬT được chép xong - trang lỗi (render hỏng, model
 * lỗi) hoàn suất, cùng triết lý `hoanSuatVideo`: chặn tốn tiền, không phạt
 * người dùng vì lỗi của mình. Không bao giờ ném: hỏng thì trang vào `boQua`.
 */

export type TrangOcr = { so: number; chu: string; cut: boolean };
export type LyDoBoQuaOcr = "chua-cau-hinh" | "loi" | "het-tran-gio";
export type KetQuaOcr = { trang: TrangOcr[]; boQua: { so: number; lyDo: LyDoBoQuaOcr }[] };

/**
 * Số trang render trong MỘT lần chạy tiến trình con. Render cả 50 trang một
 * lượt thì một trang độc ở trang 49 (hoặc hết giờ/vượt RAM) vứt luôn 48 ảnh
 * tốt, và ~10 MB JPEG dồn qua IPC một cục.
 */
export const SO_TRANG_MOI_CUM_RENDER = 5;

export type PhuThuocOcr = {
  sidecarSanSang: () => boolean;
  render: (buf: Buffer, soTrang: number[]) => Promise<AnhTrang[]>;
  chep: (anh: { base64: string; mediaType: string }) => Promise<{ text: string; truncated: boolean } | null>;
  gioiHan: HourlyRateLimit;
  songSong: number;
};

export async function ocrCacTrang(
  buf: Buffer,
  soTrang: number[],
  nguoiGuiKey: string,
  d: PhuThuocOcr,
): Promise<KetQuaOcr> {
  const thuTu = [...new Set(soTrang)].sort((a, b) => a - b);
  const boQua: KetQuaOcr["boQua"] = [];
  if (!d.sidecarSanSang()) {
    return { trang: [], boQua: thuTu.map((so) => ({ so, lyDo: "chua-cau-hinh" })) };
  }

  const duocLam: number[] = [];
  for (const so of thuTu) {
    if (d.gioiHan.check(nguoiGuiKey).ok) duocLam.push(so);
    else boQua.push({ so, lyDo: "het-tran-gio" });
  }
  const hong = (so: number) => {
    d.gioiHan.hoanSuat(nguoiGuiKey);
    boQua.push({ so, lyDo: "loi" });
  };
  if (duocLam.length === 0) return { trang: [], boQua };

  const trang: TrangOcr[] = [];
  for (let i = 0; i < duocLam.length; i += SO_TRANG_MOI_CUM_RENDER) {
    const cum = duocLam.slice(i, i + SO_TRANG_MOI_CUM_RENDER);
    let anh: AnhTrang[];
    try {
      anh = await d.render(buf, cum);
    } catch (err) {
      // HẾT GIỜ thì dừng hẳn: tệp render chậm cỡ này thì cụm sau cũng chậm, mỗi
      // cụm lại chiếm trọn chỗ DUY NHẤT của hàng đợi trích xuất dùng chung
      // (50 trang = 10 cụm x 60s). Lỗi khác (vượt RAM ở một trang độc) thì chỉ
      // mất cụm đó - các cụm sau vẫn đáng thử.
      if (err instanceof LoiTienTrinhConBiNgat && err.lyDo === "het-gio") {
        duocLam.slice(i).forEach(hong);
        break;
      }
      cum.forEach(hong);
      continue;
    }
    const coAnh = new Map(anh.map((a) => [a.so, a]));
    for (const so of cum) if (!coAnh.has(so)) hong(so);

    const hangDoi = cum.filter((so) => coAnh.has(so));
    const tho = async () => {
      for (let so = hangDoi.shift(); so !== undefined; so = hangDoi.shift()) {
        const a = coAnh.get(so)!;
        const kq = await d.chep({ base64: Buffer.from(a.jpeg).toString("base64"), mediaType: "image/jpeg" }).catch(() => null);
        // Rỗng mà không lỗi = trang trắng thật: coi như đã chép, không hoàn suất
        // - hoàn suất thì mỗi lượt sau lại render + gọi model có trả phí cho nó
        if (kq) trang.push({ so, chu: kq.text.trim() ? kq.text : "[trang trống]", cut: kq.truncated });
        else hong(so);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, d.songSong) }, tho));
  }

  return { trang: trang.sort((a, b) => a.so - b.so), boQua: boQua.sort((a, b) => a.so - b.so) };
}
