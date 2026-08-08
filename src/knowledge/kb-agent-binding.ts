/**
 * Gán nguồn Kho tri thức cho từng agent. Lược đồ ở `kb-schema.ts`.
 *
 * Agent CHƯA gán nguồn nào thì đọc được RỖNG - mặc định ĐÓNG. Không có dòng
 * nào trong `agent_kb_sources` nghĩa là "chưa cấu hình gì", không phải "được
 * đọc hết" - đảo ngược điều này là một agent mới tạo vô tình đọc được mọi tài
 * liệu đã nạp cho agent khác.
 */

import { db } from "../conversation/database.js";

const layDanhSachStmt = db.prepare(
  `SELECT source_id FROM agent_kb_sources WHERE agent_id = ? ORDER BY source_id`,
);

export function nguonCuaAgent(agentId: string): string[] {
  const rows = layDanhSachStmt.all(agentId) as unknown as { source_id: string }[];
  return rows.map((r) => r.source_id);
}

const xoaGanCuaAgentStmt = db.prepare(`DELETE FROM agent_kb_sources WHERE agent_id = ?`);
const chenGanStmt = db.prepare(`INSERT INTO agent_kb_sources (agent_id, source_id) VALUES (?, ?)`);

/**
 * Cùng pattern `trongGiaoDich` của `kb-source-store.ts` (viết tay vì
 * `node:sqlite` không có `db.transaction()`).
 */
function trongGiaoDich<T>(viec: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const ketQua = viec();
    db.exec("COMMIT");
    return ketQua;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* giữ nguyên lỗi gốc */
    }
    throw err;
  }
}

/**
 * ĐẶT LẠI toàn bộ danh sách nguồn của agent - THAY THẾ, không cộng dồn. Dashboard
 * (phase 05) gửi nguyên danh sách checkbox đang tick, không phải danh sách thêm/bớt.
 * Lọc trùng qua `Set` phòng caller gửi id lặp - `agent_kb_sources` có PRIMARY KEY
 * (agent_id, source_id) nên id lặp sẽ làm INSERT thứ hai ném lỗi UNIQUE giữa giao
 * dịch, hỏng cả thao tác vì một lỗi vô hại đáng ra không cần chặn.
 */
export function datNguonChoAgent(agentId: string, sourceIds: string[]): void {
  const idDuyNhat = [...new Set(sourceIds)];
  trongGiaoDich(() => {
    xoaGanCuaAgentStmt.run(agentId);
    for (const sourceId of idDuyNhat) {
      chenGanStmt.run(agentId, sourceId);
    }
  });
}
