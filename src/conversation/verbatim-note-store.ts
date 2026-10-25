import { db } from "./database.js";

/**
 * Store cho ghi chú nguyên văn - xem lý do tách bảng ở `verbatim-note-schema.ts`.
 *
 * Mọi hàm đọc/sửa đều nhận `PhamViGhiChu` và chỉ đụng tới tập ghi chú model
 * ĐANG ĐƯỢC THẤY, cùng luật bất đối xứng với `memory-edit-store.ts`: ở trong
 * nhóm thì chỉ thấy ghi chú lưu trong nhóm. Không siết thì người trong nhóm
 * đọc/xóa được ghi chú lưu ở chat riêng.
 */

export type PhamViGhiChu = {
  accountId: string;
  /** Người sở hữu ghi chú (người nhắn) */
  subjectId: string;
  /** true = đang ở nhóm: chỉ thấy ghi chú lưu trong nhóm */
  chiTrongNhom: boolean;
};

export type TieuDeGhiChu = { title: string; soKyTu: number };

/** "Thông báo  Suất ăn" và "thông báo suất ăn" là cùng một tên */
export function khoaTenGhiChu(ten: string): string {
  return ten.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const DIEU_KIEN_THAY = "account_id = ? AND subject_id = ? AND (? = 0 OR learned_in_group = 1)";
const thamSo = (p: PhamViGhiChu) => [p.accountId, p.subjectId, p.chiTrongNhom ? 1 : 0] as const;

const listStmt = db.prepare(
  `SELECT title, length(content) AS so_ky_tu FROM verbatim_notes WHERE ${DIEU_KIEN_THAY} ORDER BY id`,
);
const docStmt = db.prepare(
  `SELECT title, content FROM verbatim_notes WHERE ${DIEU_KIEN_THAY} AND title_key = ?`,
);
const demStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM verbatim_notes WHERE account_id = ? AND subject_id = ?",
);
const tonTaiStmt = db.prepare(
  "SELECT 1 FROM verbatim_notes WHERE account_id = ? AND subject_id = ? AND title_key = ?",
);
const insertStmt = db.prepare(
  `INSERT INTO verbatim_notes
     (account_id, subject_id, title, title_key, content, learned_in_thread_id, learned_in_group)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const updateStmt = db.prepare(
  `UPDATE verbatim_notes
      SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE ${DIEU_KIEN_THAY} AND title_key = ?`,
);
const deleteStmt = db.prepare(`DELETE FROM verbatim_notes WHERE ${DIEU_KIEN_THAY} AND title_key = ?`);

/** Tên các ghi chú đang thấy - cho khối tiêu đề trong system prompt */
export function danhSachGhiChu(pham: PhamViGhiChu): TieuDeGhiChu[] {
  const rows = listStmt.all(...thamSo(pham)) as unknown as { title: string; so_ky_tu: number }[];
  return rows.map((r) => ({ title: r.title, soKyTu: r.so_ky_tu }));
}

export function docGhiChu(pham: PhamViGhiChu, ten: string): { title: string; content: string } | null {
  const row = docStmt.get(...thamSo(pham), khoaTenGhiChu(ten)) as
    | { title: string; content: string }
    | undefined;
  return row ?? null;
}

const tatCaStmt = db.prepare(
  `SELECT title, title_key, content FROM verbatim_notes WHERE ${DIEU_KIEN_THAY} ORDER BY id`,
);

/**
 * Tìm ghi chú cho việc ĐỌC, chịu được tên chép lệch đuôi.
 *
 * Đo trên model thật: chép tên từ khối ghi chú rồi tự thêm rác ở đuôi
 * ("Thông báo suất ăn khóa thiền भ???.", "...thiền nero") - tên không khớp,
 * model đoán tiếp và lặp tới chạm guard. Nên khi không khớp đúng, nhận ghi chú
 * DUY NHẤT mà tên gọi bắt đầu bằng tên của nó. `ganDung: true` để tool báo tên
 * thật cho model tự xét. CHỈ dùng cho đọc: sửa/xóa vẫn đòi đúng tên, vì nhầm
 * ghi chú ở đó là hỏng dữ liệu chứ không chỉ đọc nhầm.
 */
export function timGhiChuDeDoc(
  pham: PhamViGhiChu,
  ten: string,
): { title: string; content: string; ganDung: boolean } | null {
  const can = khoaTenGhiChu(ten);
  const rows = tatCaStmt.all(...thamSo(pham)) as unknown as { title: string; title_key: string; content: string }[];
  const dung = rows.find((r) => r.title_key === can);
  if (dung) return { title: dung.title, content: dung.content, ganDung: false };
  const ung = rows.filter((r) => can.startsWith(r.title_key));
  if (ung.length !== 1) return null;
  return { title: ung[0]!.title, content: ung[0]!.content, ganDung: true };
}

export type KetQuaLuuGhiChu =
  | { ok: true }
  /** Đã có ghi chú cùng tên (kể cả ghi chú không thấy được từ nhóm này) */
  | { ok: false; loai: "trung_ten" }
  | { ok: false; loai: "cham_tran"; tran: number };

/**
 * Trần đếm trên MỌI ghi chú của người này, không chỉ phần đang thấy: trần là
 * để chặn DB phình, mà ghi chú ẩn vẫn chiếm chỗ.
 *
 * Chạm trần thì TỪ CHỐI, không tự xóa ghi chú cũ nhất như `memories`: người
 * dùng nhờ lưu nguyên văn để lấy lại sau, lặng lẽ xóa mất một cái là đúng loại
 * hỏng mà tính năng này sinh ra để chữa.
 */
export function luuGhiChu(
  pham: PhamViGhiChu,
  moi: { title: string; content: string; threadId: string; isGroup: boolean },
  tran: number,
): KetQuaLuuGhiChu {
  const khoa = khoaTenGhiChu(moi.title);
  if (tonTaiStmt.get(pham.accountId, pham.subjectId, khoa)) return { ok: false, loai: "trung_ten" };
  const { n } = demStmt.get(pham.accountId, pham.subjectId) as { n: number };
  if (n >= tran) return { ok: false, loai: "cham_tran", tran };
  insertStmt.run(
    pham.accountId,
    pham.subjectId,
    moi.title.trim().replace(/\s+/g, " "),
    khoa,
    moi.content,
    moi.threadId,
    moi.isGroup ? 1 : 0,
  );
  return { ok: true };
}

/** @returns false khi không có ghi chú tên đó trong tập đang thấy */
export function thayNoiDungGhiChu(pham: PhamViGhiChu, ten: string, content: string): boolean {
  return updateStmt.run(content, ...thamSo(pham), khoaTenGhiChu(ten)).changes > 0;
}

export function xoaGhiChu(pham: PhamViGhiChu, ten: string): boolean {
  return deleteStmt.run(...thamSo(pham), khoaTenGhiChu(ten)).changes > 0;
}
