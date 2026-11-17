import { LoiTienTrinhConBiNgat } from "../shared/chay-tien-trinh-con-co-tran.js";
import type { HourlyRateLimit } from "../shared/hourly-rate-limit.js";
import { LoiTep, type KetQuaTrichXuatTep, type PhanNoiDung } from "./attachment-extract-types.js";
import { chamDocTep, ghiLoiTep, layTep, luuNoiDungTep, type MaLoiLuu, type TepDinhKem } from "./attachment-store.js";
import type { KetQuaOcr } from "./ocr-cac-trang.js";
import { daBiNgatQuaNhieu, ghiBiNgat } from "./tep-bi-ngat-gan-day.js";
import type { KetQuaTaiTep } from "./tai-tep-zalo.js";

/**
 * Lấy nội dung một tệp đính kèm: dùng cache chữ nếu còn hạn, không thì tải lại
 * từ `href` và trích xuất; trang PDF quét được OCR theo DẢI yêu cầu (lần đầu
 * chép sẵn vài trang, sau đó chép thêm khi cần).
 *
 * Mỗi tệp một hàng chờ riêng (`khoa`): hai lời gọi cùng lúc (tải sớm lúc nhận
 * tin + tool gọi ngay sau) không tải hai lần - lời gọi sau chạy khi lời gọi
 * trước xong và thấy cache ấm.
 *
 * Lỗi có tính VĨNH VIỄN (link hết hạn, mật khẩu, hỏng, quá lớn) được ghi lại để
 * lần sau trả ngay; lỗi THOÁNG QUA (mạng, tiến trình con bị giết) thì không -
 * lần sau thử lại. Không bao giờ ném.
 */

export type PhuThuocLayTep = {
  taiTep: (href: string, maxBytes: number, duoiKhai: string) => Promise<KetQuaTaiTep>;
  /**
   * Lý do OCR KHÔNG chạy được lúc này cho người gửi (chưa cấu hình model đọc
   * ảnh / hết suất trang mỗi giờ), null = chạy được. Kiểm TRƯỚC khi tải lại tệp:
   * không thì mỗi lượt hỏi lại tải trọn tệp chỉ để biết là không OCR được.
   */
  lyDoKhongOcr: (nguoiGuiKey: string) => "chua-cau-hinh" | "het-tran-gio" | null;
  trichXuat: (buf: Buffer, duoiKhai: string) => Promise<KetQuaTrichXuatTep>;
  ocr: (buf: Buffer, soTrang: number[], nguoiGuiKey: string) => Promise<KetQuaOcr>;
  gioiHanTep: HourlyRateLimit;
  /**
   * Chờ lượt giữ byte (xem `gioi-han-luot-tai-tep.ts`) - gọi ngay TRƯỚC lần
   * tải đầu tiên của lời gọi, nhả khi lời gọi xong. Đọc từ cache thì không giữ.
   */
  giuLuotTai: (nguoiGuiKey: string) => Promise<() => void>;
  cauHinh: () => { maxMb: number; officeMaxMb: number; ocrSanTrang: number; ocrToiDaMoiTep: number };
};

export type MaLoiLayTep = MaLoiLuu | "qua-lon" | "mang" | "bi-ngat" | "het-tran-gio";

export type KetQuaLayTep =
  | {
      ok: true;
      tep: TepDinhKem;
      noiDung: PhanNoiDung[];
      trangDaOcr: number[];
      /** Trang cần OCR, trong trần mỗi tệp, chưa chép */
      trangChuaOcr: number[];
      /** Trang cần OCR nhưng vượt trần mỗi tệp - không bao giờ chép */
      trangVuotTran: number[];
      boQuaOcr: KetQuaOcr["boQua"];
      canhBao: string[];
    }
  | { ok: false; ma: MaLoiLayTep };

const MB = 1024 * 1024;
/**
 * Office (zip hoặc OLE) theo CHỮ KÝ byte đầu - không đọc mục lục: một zip
 * hỏng mục lục cũng phải chịu trần Office (nén phình mạnh hơn PDF).
 */
const laOfficeTheoByte = (b: Buffer) =>
  b.length >= 8 && (b.readUInt32LE(0) === 0x04034b50 || b.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1");
const khoa = new Map<number, Promise<unknown>>();

export function layNoiDungTep(
  tep: TepDinhKem,
  p: { nguoiGuiKey: string; now: Date; daiTrang?: [number, number]; deps: PhuThuocLayTep },
): Promise<KetQuaLayTep> {
  const truoc = khoa.get(tep.id) ?? Promise.resolve();
  const lan = truoc.then(() => thucHien(tep.id, p));
  const duoi = lan.catch(() => undefined);
  khoa.set(tep.id, duoi);
  void duoi.then(() => {
    if (khoa.get(tep.id) === duoi) khoa.delete(tep.id);
  });
  return lan;
}

type KetQuaTai = { loi: "het-tran-gio" | "het-han" | "qua-lon" | "host-la" | "mang" } | { buf: Buffer };

/**
 * Tải byte tệp, TÍNH một suất tệp mỗi giờ (cả khi tải lại để OCR thêm trang).
 * Không đọc được gì (mạng, host lạ, quá trần) thì hoàn suất. Ghi lại lỗi chỉ
 * khi vĩnh viễn với tệp này: link chết, host lạ. Quá trần thì KHÔNG ghi - người
 * vận hành nâng trần trên dashboard là đọc được ngay.
 */
async function taiByte(
  t: TepDinhKem,
  d: PhuThuocLayTep,
  nguoiGuiKey: string,
  giu: { nha?: () => void },
): Promise<KetQuaTai> {
  const ch = d.cauHinh();
  if (!giu.nha) giu.nha = await d.giuLuotTai(nguoiGuiKey);
  if (!d.gioiHanTep.check(nguoiGuiKey).ok) return { loi: "het-tran-gio" };
  const tai = await d.taiTep(t.href, ch.maxMb * MB, t.duoiKhai).catch((): KetQuaTaiTep => ({ ok: false, ma: "mang" }));
  if (!tai.ok) {
    if (tai.ma !== "het-han") d.gioiHanTep.hoanSuat(nguoiGuiKey);
    if (tai.ma === "het-han" || tai.ma === "host-la") ghiLoiTep(t.id, tai.ma);
    return { loi: tai.ma };
  }
  if (laOfficeTheoByte(tai.buf) && tai.buf.length > ch.officeMaxMb * MB) {
    d.gioiHanTep.hoanSuat(nguoiGuiKey);
    return { loi: "qua-lon" };
  }
  return { buf: tai.buf };
}

async function thucHien(id: number, p: Parameters<typeof layNoiDungTep>[1]): Promise<KetQuaLayTep> {
  const giu: { nha?: () => void } = {};
  try {
    return await thucHienTrongLuot(id, p, giu);
  } finally {
    giu.nha?.();
  }
}

async function thucHienTrongLuot(
  id: number,
  p: Parameters<typeof layNoiDungTep>[1],
  giu: { nha?: () => void },
): Promise<KetQuaLayTep> {
  const d = p.deps;
  const t = layTep(id);
  if (!t || t.xoaLuc <= p.now.toISOString()) return { ok: false, ma: "het-han" };
  const conCache = t.noiDung !== null && t.cacheHetHan !== null && t.cacheHetHan > p.now.toISOString();
  // Lỗi đã ghi (link chết...) chặn việc TẢI, không chặn chữ còn trong cache
  if (t.maLoi && !conCache) return { ok: false, ma: t.maLoi };
  let buf: Buffer | undefined;
  let kq: { dinhDang: TepDinhKem["dinhDang"]; soTrang: number | null; noiDung: PhanNoiDung[]; trangCanOcr: number[]; canhBao: string[] };
  try {
    if (conCache) {
      kq = { dinhDang: t.dinhDang, soTrang: t.soTrang, noiDung: t.noiDung!, trangCanOcr: t.trangCanOcr, canhBao: t.canhBao };
    } else {
      if (daBiNgatQuaNhieu(id, p.now)) return { ok: false, ma: "bi-ngat" };
      const tai = await taiByte(t, d, p.nguoiGuiKey, giu);
      if ("loi" in tai) return { ok: false, ma: tai.loi };
      buf = tai.buf;
      const tx = await d.trichXuat(buf, t.duoiKhai);
      if (tx.dinhDang === "anh") throw new LoiTep("chua-ho-tro", "Đây là ảnh gửi dạng tệp");
      kq = { dinhDang: tx.dinhDang, soTrang: tx.soTrang ?? null, noiDung: tx.phan, trangCanOcr: tx.trangCanOcr, canhBao: tx.canhBao };
    }
  } catch (err) {
    if (err instanceof LoiTep) {
      ghiLoiTep(id, err.ma);
      return { ok: false, ma: err.ma };
    }
    if (err instanceof LoiTienTrinhConBiNgat) {
      ghiBiNgat(id, p.now);
      return { ok: false, ma: "bi-ngat" };
    }
    return { ok: false, ma: "mang" };
  }

  // OCR: chỉ trong trần mỗi tệp; mặc định (không xin dải) chép sẵn vài trang đầu
  const ch = d.cauHinh();
  const trongTran = kq.trangCanOcr.slice(0, ch.ocrToiDaMoiTep);
  const trangVuotTran = kq.trangCanOcr.slice(ch.ocrToiDaMoiTep);
  const daOcr = new Set(conCache ? t.trangDaOcr : []);
  const muon = p.daiTrang
    ? trongTran.filter((s) => s >= p.daiTrang![0] && s <= p.daiTrang![1])
    : trongTran.slice(0, ch.ocrSanTrang);
  const canLam = muon.filter((s) => !daOcr.has(s));

  let boQuaOcr: KetQuaOcr["boQua"] = [];
  let noiDung = kq.noiDung;
  let soTrangMoi = 0;
  const lyDoKhongOcr = canLam.length > 0 ? d.lyDoKhongOcr(p.nguoiGuiKey) : null;
  if (lyDoKhongOcr) {
    boQuaOcr = canLam.map((so) => ({ so, lyDo: lyDoKhongOcr }));
  } else if (canLam.length > 0) {
    if (!buf && t.maLoi) {
      // Link đã biết là chết - không thử tải lại, chỉ phục vụ chữ còn trong cache
      boQuaOcr = canLam.map((so) => ({ so, lyDo: "loi" }));
    } else if (!buf) {
      // Cache chữ còn nhưng cần trang quét mới: tải lại byte (tính suất như tải mới)
      const tai = await taiByte(t, d, p.nguoiGuiKey, giu);
      if ("loi" in tai) boQuaOcr = canLam.map((so) => ({ so, lyDo: tai.loi === "het-tran-gio" ? "het-tran-gio" : "loi" }));
      else buf = tai.buf;
    }
    if (buf) {
      const ocr = await d.ocr(buf, canLam, p.nguoiGuiKey);
      boQuaOcr = ocr.boQua;
      for (const tr of ocr.trang) daOcr.add(tr.so);
      soTrangMoi = ocr.trang.length;
      const moi: PhanNoiDung[] = ocr.trang.map((tr) => ({
        nhan: `Trang ${tr.so}${tr.cut ? " (chép dở - chạm trần độ dài)" : ""}`,
        chu: tr.chu,
        nguon: "ocr",
      }));
      noiDung = [...noiDung, ...moi].sort((a, b) => soCuaNhan(a.nhan) - soCuaNhan(b.nhan));
    }
  }

  const trangDaOcr = [...daOcr].sort((a, b) => a - b);
  // Không có gì mới thì chỉ gia hạn - ghi lại sẽ xóa mất mã lỗi vừa ghi (link chết)
  if (!conCache || soTrangMoi > 0) {
    luuNoiDungTep(id, { dinhDang: kq.dinhDang!, soTrang: kq.soTrang ?? undefined, noiDung, trangDaOcr, trangCanOcr: kq.trangCanOcr, canhBao: kq.canhBao }, p.now);
  } else {
    chamDocTep(id, p.now);
  }
  return {
    ok: true,
    tep: layTep(id) ?? t,
    noiDung,
    trangDaOcr,
    trangChuaOcr: trongTran.filter((s) => !daOcr.has(s)),
    trangVuotTran,
    boQuaOcr,
    canhBao: kq.canhBao,
  };
}

/** "Trang 12 ..." -> 12; phần không có số trang (docx, sheet) giữ thứ tự gốc */
function soCuaNhan(nhan: string): number {
  const m = /^Trang (\d+)/.exec(nhan);
  return m ? Number(m[1]) : 0;
}
