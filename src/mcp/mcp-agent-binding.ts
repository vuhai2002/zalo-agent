/**
 * Gán server MCP cho từng agent. Agent CHƯA gán server nào -> RỖNG (mặc định
 * ĐÓNG). Đảo ngược điều này là để một agent mới vô tình dùng được server của
 * agent khác. SAO Y `kb-agent-binding.ts`, đổi bảng/tên.
 */

import { db } from "../conversation/database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";

const layStmt = db.prepare(`SELECT server_id FROM agent_mcp_servers WHERE agent_id = ? ORDER BY server_id`);
const layTheoServerStmt = db.prepare(`SELECT agent_id FROM agent_mcp_servers WHERE server_id = ? ORDER BY agent_id`);
const xoaCuaAgentStmt = db.prepare(`DELETE FROM agent_mcp_servers WHERE agent_id = ?`);
const xoaCuaServerStmt = db.prepare(`DELETE FROM agent_mcp_servers WHERE server_id = ?`);
const chenStmt = db.prepare(`INSERT INTO agent_mcp_servers (agent_id, server_id) VALUES (?, ?)`);
const demStmt = db.prepare(`SELECT server_id, COUNT(*) AS so FROM agent_mcp_servers GROUP BY server_id`);

export function serversCuaAgent(agentId: string): string[] {
  return (layStmt.all(agentId) as { server_id: string }[]).map((r) => r.server_id);
}

/** Chiều NGƯỢC - server nào đang gán cho agent nào (dashboard hỏi trước khi xóa server). */
export function agentCuaServer(serverId: string): string[] {
  return (layTheoServerStmt.all(serverId) as { agent_id: string }[]).map((r) => r.agent_id);
}

/** THAY THẾ toàn bộ danh sách của agent, không cộng dồn. Lọc trùng qua Set phòng id lặp. */
export function datServerChoAgent(agentId: string, serverIds: string[]): void {
  const uniq = [...new Set(serverIds)];
  trongGiaoDich(db, () => {
    xoaCuaAgentStmt.run(agentId);
    for (const s of uniq) chenStmt.run(agentId, s);
  });
}

/** Chiều ngược của `datServerChoAgent` - gán một server cho danh sách agent. */
export function datAgentChoServer(serverId: string, agentIds: string[]): void {
  const uniq = [...new Set(agentIds)];
  trongGiaoDich(db, () => {
    xoaCuaServerStmt.run(serverId);
    for (const a of uniq) chenStmt.run(a, serverId);
  });
}

/** Server KHÔNG có agent nào sẽ VẮNG MẶT trong Map - caller hiểu "không có khóa" là 0. */
export function demAgentTheoServer(): Map<string, number> {
  return new Map((demStmt.all() as { server_id: string; so: number }[]).map((r) => [r.server_id, r.so]));
}

/** Dọn sạch gán của một agent - gọi từ `agent-store.ts` khi agent bị XÓA (chống hồi sinh dòng mồ côi). */
export function xoaGanServerCuaAgent(agentId: string): void {
  xoaCuaAgentStmt.run(agentId);
}
