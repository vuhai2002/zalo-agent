import { getTuning } from "../config/runtime-tuning-settings.js";
import { db } from "../conversation/database.js";
import type { IncomingFile } from "../zalo/zalo-message-parser.js";
import type { DinhDangTep, MaLoiTep, PhanNoiDung } from "./attachment-extract-types.js";

/**
 * Kho tệp đính kèm - xem `attachment-schema.ts` cho ba lớp tuổi thọ.
 *
 * Mọi hàm nhận `now` TƯỜNG MINH (không `= new Date()` mặc định) - cùng luật
 * `proactive-send-guard.ts`: một lượt dùng chung một mốc, và trình biên dịch
 * canh hộ chỗ quên truyền.
 */

/** Lỗi được GHI LẠI vì vĩnh viễn với tệp này (link không bao giờ đổi). Lỗi vượt trần dung lượng KHÔNG ghi: người vận hành có thể nâng trần. */
export type MaLoiLuu = MaLoiTep | "het-han" | "host-la";

export type TepDinhKem = {
  id: number;
  accountId: string;
  threadId: string;
  senderId: string;
  ten: string;
  duoiKhai: string;
  coKhai: number | null;
  href: string;
  createdAt: string;
  xoaLuc: string;
  dinhDang: DinhDangTep | null;
  soTrang: number | null;
  /** null = chưa trích hoặc cache đã hết hạn */
  noiDung: PhanNoiDung[] | null;
  trangDaOcr: number[];
  /** PDF: trang không có lớp chữ, cần OCR (cả những trang chưa làm) */
  trangCanOcr: number[];
  canhBao: string[];
  maLoi: MaLoiLuu | null;
  cacheHetHan: string | null;
};

type Dong = Record<string, string | number | null>;

const MOT_GIO = 3_600_000;

function sangTep(d: Dong): TepDinhKem {
  return {
    id: Number(d.id),
    accountId: String(d.account_id),
    threadId: String(d.thread_id),
    senderId: String(d.sender_id),
    ten: String(d.ten),
    duoiKhai: String(d.duoi_khai),
    coKhai: d.co_khai === null ? null : Number(d.co_khai),
    href: String(d.href),
    createdAt: String(d.created_at),
    xoaLuc: String(d.xoa_luc),
    dinhDang: (d.dinh_dang as DinhDangTep | null) ?? null,
    soTrang: d.so_trang === null ? null : Number(d.so_trang),
    noiDung: d.noi_dung_json ? (JSON.parse(String(d.noi_dung_json)) as PhanNoiDung[]) : null,
    trangDaOcr: d.trang_ocr_json ? (JSON.parse(String(d.trang_ocr_json)) as number[]) : [],
    trangCanOcr: d.trang_can_ocr_json ? (JSON.parse(String(d.trang_can_ocr_json)) as number[]) : [],
    canhBao: d.canh_bao_json ? (JSON.parse(String(d.canh_bao_json)) as string[]) : [],
    maLoi: (d.ma_loi as MaLoiLuu | null) ?? null,
    cacheHetHan: (d.cache_het_han as string | null) ?? null,
  };
}

const chen = db.prepare(
  `INSERT INTO tep_dinh_kem (account_id, thread_id, history_row_id, sender_id, ten, duoi_khai, co_khai, href, created_at, xoa_luc)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const docMot = db.prepare("SELECT * FROM tep_dinh_kem WHERE id = ?");
const ganDay = db.prepare(
  "SELECT * FROM tep_dinh_kem WHERE account_id = ? AND thread_id = ? AND xoa_luc > ? ORDER BY id DESC LIMIT ?",
);
const luuNoiDung = db.prepare(
  `UPDATE tep_dinh_kem SET dinh_dang = ?, so_trang = ?, noi_dung_json = ?, trang_ocr_json = ?, trang_can_ocr_json = ?,
     canh_bao_json = ?, ma_loi = NULL, cache_het_han = MIN(?, xoa_luc) WHERE id = ?`,
);
const luuLoi = db.prepare("UPDATE tep_dinh_kem SET ma_loi = ? WHERE id = ?");
const cham = db.prepare("UPDATE tep_dinh_kem SET cache_het_han = MIN(?, xoa_luc) WHERE id = ? AND noi_dung_json IS NOT NULL");
const boCache = db.prepare(
  "UPDATE tep_dinh_kem SET noi_dung_json = NULL, trang_ocr_json = NULL, trang_can_ocr_json = NULL, canh_bao_json = NULL, cache_het_han = NULL WHERE cache_het_han <= ?",
);
const xoaHetHan = db.prepare("DELETE FROM tep_dinh_kem WHERE xoa_luc <= ?");
const xoaThread = db.prepare("DELETE FROM tep_dinh_kem WHERE account_id = ? AND thread_id = ?");
const xoaAccount = db.prepare("DELETE FROM tep_dinh_kem WHERE account_id = ?");

const hanTruot = (now: Date) => new Date(now.getTime() + getTuning("ATTACHMENT_CACHE_IDLE_HOURS") * MOT_GIO).toISOString();

export function ghiTepDen(
  accountId: string,
  threadId: string,
  historyRowId: number,
  senderId: string,
  file: IncomingFile,
  now: Date,
): number {
  const xoaLuc = new Date(now.getTime() + getTuning("ATTACHMENT_RETENTION_DAYS") * 24 * MOT_GIO).toISOString();
  const kq = chen.run(accountId, threadId, historyRowId, senderId, file.ten, file.duoiKhai, file.coKhai, file.href, now.toISOString(), xoaLuc);
  return Number(kq.lastInsertRowid);
}

export function layTep(id: number): TepDinhKem | undefined {
  const d = docMot.get(id) as Dong | undefined;
  return d ? sangTep(d) : undefined;
}

/** Tệp còn hạn của thread, MỚI NHẤT trước (`tepSo` 1 = phần tử đầu) */
export function layTepGanDay(accountId: string, threadId: string, now: Date, gioiHan = 10): TepDinhKem[] {
  return (ganDay.all(accountId, threadId, now.toISOString(), gioiHan) as Dong[]).map(sangTep);
}

export function luuNoiDungTep(
  id: number,
  kq: {
    dinhDang: DinhDangTep;
    soTrang?: number;
    noiDung: PhanNoiDung[];
    trangDaOcr: number[];
    trangCanOcr?: number[];
    canhBao?: string[];
  },
  now: Date,
): void {
  luuNoiDung.run(
    kq.dinhDang,
    kq.soTrang ?? null,
    JSON.stringify(kq.noiDung),
    JSON.stringify(kq.trangDaOcr),
    JSON.stringify(kq.trangCanOcr ?? []),
    JSON.stringify(kq.canhBao ?? []),
    hanTruot(now),
    id,
  );
}

export function ghiLoiTep(id: number, ma: MaLoiLuu): void {
  luuLoi.run(ma, id);
}

/** Gia hạn cache chữ sau một lần đọc - không vượt `xoa_luc` */
export function chamDocTep(id: number, now: Date): void {
  cham.run(hanTruot(now), id);
}

export function xoaCacheHetHan(now: Date): number {
  return Number(boCache.run(now.toISOString()).changes);
}

export function xoaTepHetHan(now: Date): number {
  return Number(xoaHetHan.run(now.toISOString()).changes);
}

export function xoaTepCuaThread(accountId: string, threadId: string): number {
  return Number(xoaThread.run(accountId, threadId).changes);
}

export function xoaTepCuaAccount(accountId: string): number {
  return Number(xoaAccount.run(accountId).changes);
}
