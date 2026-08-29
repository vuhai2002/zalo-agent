import type { DatabaseSync } from "node:sqlite";

/**
 * Lược đồ MCP client: server ngoài + gán server cho agent (default-deny).
 *
 * Gọi từ `database.ts` (`runMigrations()`), CÙNG connection với mọi bảng
 * khác trong DB. KHÔNG FOREIGN KEY: `database.ts` không bật
 * `PRAGMA foreign_keys` nên `REFERENCES` chỉ là lời hứa suông - mọi nơi xóa
 * (`xoaServer`, `deleteAgent`) phải tự dọn cả hai bảng tường minh trong một
 * giao dịch, cùng nếp `kb_sources`/`agent_kb_sources`.
 *
 * `id` của `mcp_servers` sinh bằng `randomBytes(8).toString("hex")` (không
 * phải slug từ tên) - tránh một server MỚI trùng tên với server đã xóa "hồi
 * sinh" nhầm các dòng `agent_mcp_servers` cũ.
 */
export function taoBangMcp(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id             TEXT PRIMARY KEY,
      ten            TEXT NOT NULL,
      url            TEXT NOT NULL,
      headers_ma_hoa TEXT NOT NULL DEFAULT '',
      enabled        INTEGER NOT NULL DEFAULT 1,
      trang_thai     TEXT NOT NULL DEFAULT 'cho_ket_noi'
                     CHECK (trang_thai IN ('cho_ket_noi','da_ket_noi','loi','can_duyet_lai')),
      loi            TEXT NOT NULL DEFAULT '',
      tools_snapshot TEXT NOT NULL DEFAULT '',
      fingerprint    TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS agent_mcp_servers (
      agent_id  TEXT NOT NULL,
      server_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, server_id)
    );
  `);
}
