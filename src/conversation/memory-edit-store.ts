import { db } from "./database.js";

/**
 * Sửa và xóa fact đã nhớ, khớp theo ĐOẠN CHỮ NGẮN thay vì id.
 *
 * Vì sao không dùng id: model không thấy id trong prompt - fact được nhét vào
 * dưới dạng gạch đầu dòng trần. Bắt nó nhớ id là bắt nhớ thứ nó chưa từng đọc.
 * Hermes gặp đúng bài toán này và chọn khớp chuỗi con (`tools/memory_tool.py`,
 * `replace`/`remove` nhận `old_text`), mình theo cùng ngữ nghĩa:
 *
 *   - không khớp gì  -> trả về danh sách fact hiện có để model thử lại cho đúng
 *   - khớp nhiều fact KHÁC nhau -> từ chối, bắt model nói cụ thể hơn
 *   - khớp nhiều fact TRÙNG KHÍT -> làm trên cái đầu tiên, an toàn
 *
 * Không bao giờ đoán bừa: sửa nhầm một fact còn tệ hơn không sửa được.
 *
 * ĐIỂM KHÁC HERMES, và là chỗ dễ hỏng nhất ở đây: Hermes chỉ phục vụ một người
 * dùng nên fact nào cũng thấy được. Bot này đọc tin trong nhóm, mà luật inject
 * là BẤT ĐỐI XỨNG (fact học ở chat riêng không bao giờ hiện trong nhóm - xem
 * `memory-store.ts`). Nên tập fact được phép khớp PHẢI hẹp đúng bằng tập model
 * đang nhìn thấy. Không siết chỗ này thì có hai lỗ cùng lúc:
 *
 *   1. người trong nhóm sửa hoặc XÓA được fact học ở chat riêng
 *   2. câu báo "không khớp, đây là các fact hiện có" RÒ luôn fact riêng ra nhóm
 */

export type KetQuaSuaFact =
  | { ok: true; noiDungCu: string }
  /** Không fact nào chứa đoạn chữ đó - kèm danh sách để model thử lại */
  | { ok: false; loai: "khong_khop"; factHienCo: string[] }
  /** Nhiều fact khác nhau cùng chứa đoạn đó - model phải nói cụ thể hơn */
  | { ok: false; loai: "khop_nhieu"; factKhop: string[] };

type Row = { id: number; content: string };

/**
 * Fact model ĐANG NHÌN THẤY về subject này, đúng luật inject.
 *
 * `chiFactHocTrongNhom` = true khi đang ở nhóm và subject là một NGƯỜI: lúc đó
 * chỉ fact học trong nhóm mới được đụng tới.
 */
const factNhinThayStmt = db.prepare(`
  SELECT id, content FROM memories
  WHERE account_id = ? AND subject_id = ?
  ORDER BY id
`);
const factNhinThayTrongNhomStmt = db.prepare(`
  SELECT id, content FROM memories
  WHERE account_id = ? AND subject_id = ? AND learned_in_group = 1
  ORDER BY id
`);

const updateStmt = db.prepare("UPDATE memories SET content = ? WHERE id = ?");
const deleteByIdStmt = db.prepare("DELETE FROM memories WHERE id = ?");

export type PhamViSuaFact = {
  accountId: string;
  subjectId: string;
  /** true = chỉ được đụng fact học trong nhóm (đang ở nhóm, subject là một người) */
  chiFactHocTrongNhom: boolean;
};

function timFactKhop(
  pham: PhamViSuaFact,
  doanChu: string,
): { chon: Row } | { loi: KetQuaSuaFact } {
  const can = doanChu.trim().toLowerCase();
  const dangCo = (
    pham.chiFactHocTrongNhom
      ? factNhinThayTrongNhomStmt.all(pham.accountId, pham.subjectId)
      : factNhinThayStmt.all(pham.accountId, pham.subjectId)
  ) as unknown as Row[];

  const khop = dangCo.filter((r) => r.content.toLowerCase().includes(can));

  if (khop.length === 0) {
    return { loi: { ok: false, loai: "khong_khop", factHienCo: dangCo.map((r) => r.content) } };
  }
  if (khop.length > 1) {
    // Trùng khít nhau thì làm trên cái đầu - không có gì để chọn nhầm.
    // Học từ Hermes: `if len(unique_texts) > 1` mới báo lỗi.
    const khacNhau = new Set(khop.map((r) => r.content));
    if (khacNhau.size > 1) {
      return { loi: { ok: false, loai: "khop_nhieu", factKhop: khop.map((r) => r.content) } };
    }
  }
  return { chon: khop[0]! };
}

/** Thay nội dung fact đang chứa `doanChu` bằng `noiDungMoi` */
export function suaFactTheoDoanChu(
  pham: PhamViSuaFact,
  doanChu: string,
  noiDungMoi: string,
): KetQuaSuaFact {
  const tim = timFactKhop(pham, doanChu);
  if ("loi" in tim) return tim.loi;
  updateStmt.run(noiDungMoi, tim.chon.id);
  return { ok: true, noiDungCu: tim.chon.content };
}

/** Xóa fact đang chứa `doanChu` */
export function xoaFactTheoDoanChu(pham: PhamViSuaFact, doanChu: string): KetQuaSuaFact {
  const tim = timFactKhop(pham, doanChu);
  if ("loi" in tim) return tim.loi;
  deleteByIdStmt.run(tim.chon.id);
  return { ok: true, noiDungCu: tim.chon.content };
}
