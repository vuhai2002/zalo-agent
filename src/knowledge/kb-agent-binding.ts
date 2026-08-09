/**
 * Gán nguồn Kho tri thức cho từng agent. Lược đồ ở `kb-schema.ts`.
 *
 * Agent CHƯA gán nguồn nào thì đọc được RỖNG - mặc định ĐÓNG. Không có dòng
 * nào trong `agent_kb_sources` nghĩa là "chưa cấu hình gì", không phải "được
 * đọc hết" - đảo ngược điều này là một agent mới tạo vô tình đọc được mọi tài
 * liệu đã nạp cho agent khác.
 */

import { db } from "../conversation/database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";

const layDanhSachStmt = db.prepare(
  `SELECT source_id FROM agent_kb_sources WHERE agent_id = ? ORDER BY source_id`,
);

export function nguonCuaAgent(agentId: string): string[] {
  const rows = layDanhSachStmt.all(agentId) as unknown as { source_id: string }[];
  return rows.map((r) => r.source_id);
}

const layAgentTheoNguonStmt = db.prepare(
  `SELECT agent_id FROM agent_kb_sources WHERE source_id = ? ORDER BY agent_id`,
);

/**
 * Chiều NGƯỢC của `nguonCuaAgent` - agent nào đang gán nguồn này. Dashboard
 * (I19) đọc hàm này TRƯỚC khi hiện hộp xác nhận xóa nguồn: xóa xong các agent
 * này mất quyền tra cứu ngay lập tức, hộp thoại phải nói thật con số đó thay
 * vì câu cảnh báo chung chung không nói gì cụ thể.
 */
export function agentCuaNguon(sourceId: string): string[] {
  const rows = layAgentTheoNguonStmt.all(sourceId) as unknown as { agent_id: string }[];
  return rows.map((r) => r.agent_id);
}

const xoaGanCuaAgentStmt = db.prepare(`DELETE FROM agent_kb_sources WHERE agent_id = ?`);
const chenGanStmt = db.prepare(`INSERT INTO agent_kb_sources (agent_id, source_id) VALUES (?, ?)`);

/**
 * ĐẶT LẠI toàn bộ danh sách nguồn của agent - THAY THẾ, không cộng dồn. Dashboard
 * (phase 05) gửi nguyên danh sách checkbox đang tick, không phải danh sách thêm/bớt.
 * Lọc trùng qua `Set` phòng caller gửi id lặp - `agent_kb_sources` có PRIMARY KEY
 * (agent_id, source_id) nên id lặp sẽ làm INSERT thứ hai ném lỗi UNIQUE giữa giao
 * dịch, hỏng cả thao tác vì một lỗi vô hại đáng ra không cần chặn.
 */
export function datNguonChoAgent(agentId: string, sourceIds: string[]): void {
  const idDuyNhat = [...new Set(sourceIds)];
  trongGiaoDich(db, () => {
    xoaGanCuaAgentStmt.run(agentId);
    for (const sourceId of idDuyNhat) {
      chenGanStmt.run(agentId, sourceId);
    }
  });
}

/**
 * Dọn sạch gán nguồn của một agent - gọi từ `agent-store.ts` khi agent bị
 * XÓA. Agent id là SLUG TẤT ĐỊNH sinh từ tên (`slugify-vietnamese.ts`): xóa
 * agent "Bán hàng" (id `ban-hang`) rồi tạo lại agent CÙNG TÊN sẽ ra ĐÚNG id
 * cũ. Thiếu bước dọn này thì agent "mới" (thật ra trùng id với agent cũ đã
 * xóa) đọc lại được tài liệu chưa ai từng gán cho NÓ - lật ngược bất biến
 * "mặc định ĐÓNG" ở đầu file này.
 */
export function xoaGanNguonCuaAgent(agentId: string): void {
  xoaGanCuaAgentStmt.run(agentId);
}
