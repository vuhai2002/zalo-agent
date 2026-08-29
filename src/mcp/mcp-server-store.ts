/**
 * CRUD server MCP ngoài + mã hóa header xác thực. Lược đồ ở `mcp-schema.ts`.
 *
 * Soi `kb-source-store.ts` (mẫu store): id `randomBytes(8).hex`, prepared
 * statement module-level, `mapRow` snake_case -> camelCase.
 */

import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../config/secret-cipher.js";
import { db } from "../conversation/database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";
import type { McpServer, McpServerNoiBo, McpToolInfo, TrangThaiServer } from "./mcp-types.js";

type Row = {
  id: string;
  ten: string;
  url: string;
  headers_ma_hoa: string;
  enabled: number;
  trang_thai: TrangThaiServer;
  loi: string;
  tools_snapshot: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
};

/** Giải mã hỏng (key đổi, dữ liệu hư) -> rơi về rỗng thay vì chết cả tiến trình. */
function giaiMaHeaders(maHoa: string): Record<string, string> {
  if (!maHoa) return {};
  try {
    return JSON.parse(decryptSecret(maHoa)) as Record<string, string>;
  } catch {
    return {};
  }
}

function docSnapshot(json: string): McpToolInfo[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as McpToolInfo[];
  } catch {
    return [];
  }
}

function mapRow(r: Row): McpServer {
  return {
    id: r.id,
    ten: r.ten,
    url: r.url,
    enabled: r.enabled === 1,
    trangThai: r.trang_thai,
    loi: r.loi,
    toolsSnapshot: docSnapshot(r.tools_snapshot),
    hasHeaders: r.headers_ma_hoa !== "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const insertStmt = db.prepare(
  `INSERT INTO mcp_servers (id, ten, url, headers_ma_hoa, enabled) VALUES (?, ?, ?, ?, ?)`,
);
const getStmt = db.prepare(`SELECT * FROM mcp_servers WHERE id = ?`);
const listStmt = db.prepare(`SELECT * FROM mcp_servers ORDER BY created_at`);
const setHeadersStmt = db.prepare(
  `UPDATE mcp_servers SET headers_ma_hoa = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
);
const setTrangThaiStmt = db.prepare(
  `UPDATE mcp_servers SET trang_thai = ?, loi = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
);
const setSnapshotStmt = db.prepare(`UPDATE mcp_servers SET tools_snapshot = ?, fingerprint = ? WHERE id = ?`);
const getFpStmt = db.prepare(`SELECT fingerprint FROM mcp_servers WHERE id = ?`);
const xoaGanServerStmt = db.prepare(`DELETE FROM agent_mcp_servers WHERE server_id = ?`);
const xoaServerStmt = db.prepare(`DELETE FROM mcp_servers WHERE id = ?`);

export function taoServer(p: {
  ten: string;
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}): McpServer {
  const id = randomBytes(8).toString("hex");
  const maHoa = p.headers && Object.keys(p.headers).length ? encryptSecret(JSON.stringify(p.headers)) : "";
  insertStmt.run(id, p.ten, p.url, maHoa, p.enabled === false ? 0 : 1);
  // Vừa tự ghi xong với id vừa sinh nên đọc lại không thể miss - không kiểm null.
  return mapRow(getStmt.get(id) as Row);
}

/** Headers GIẢI MÃ - chỉ nội bộ (manager kết nối) gọi, không lộ qua API dashboard. */
export function layServerNoiBo(id: string): McpServerNoiBo | null {
  const r = getStmt.get(id) as Row | undefined;
  return r ? { ...mapRow(r), headers: giaiMaHeaders(r.headers_ma_hoa) } : null;
}

/** KHÔNG kèm headers - an toàn trả thẳng cho API dashboard. */
export function danhSachServer(): McpServer[] {
  return (listStmt.all() as Row[]).map(mapRow);
}

/** `headers === undefined` => GIỮ NGUYÊN header cũ ("ô trống = giữ key cũ"). */
export function capNhatServer(
  id: string,
  patch: { ten?: string; url?: string; headers?: Record<string, string>; enabled?: boolean },
): void {
  const dat: string[] = [];
  const val: unknown[] = [];
  if (patch.ten !== undefined) {
    dat.push("ten = ?");
    val.push(patch.ten);
  }
  if (patch.url !== undefined) {
    dat.push("url = ?");
    val.push(patch.url);
  }
  if (patch.enabled !== undefined) {
    dat.push("enabled = ?");
    val.push(patch.enabled ? 1 : 0);
  }
  if (patch.headers !== undefined) {
    dat.push("headers_ma_hoa = ?");
    val.push(Object.keys(patch.headers).length ? encryptSecret(JSON.stringify(patch.headers)) : "");
  }
  if (!dat.length) return;
  dat.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.prepare(`UPDATE mcp_servers SET ${dat.join(", ")} WHERE id = ?`).run(...(val as never[]), id);
}

/** Đường XÓA header riêng - tách khỏi `capNhatServer` vì "ô trống = giữ nguyên". */
export function xoaHeaders(id: string): void {
  setHeadersStmt.run("", id);
}

/** Không có FOREIGN KEY nên phải tự dọn `agent_mcp_servers` trong CÙNG giao dịch. */
export function xoaServer(id: string): void {
  trongGiaoDich(db, () => {
    xoaGanServerStmt.run(id);
    xoaServerStmt.run(id);
  });
}

export function datTrangThaiServer(id: string, trangThai: TrangThaiServer, loi = ""): void {
  setTrangThaiStmt.run(trangThai, loi, id);
}

export function luuSnapshotFingerprint(id: string, snapshot: McpToolInfo[], fingerprintJson: string): void {
  setSnapshotStmt.run(JSON.stringify(snapshot), fingerprintJson, id);
}

/** Rỗng nếu server chưa từng nối thành công / chưa có mốc drift. */
export function layFingerprint(id: string): string {
  return (getFpStmt.get(id) as { fingerprint: string } | undefined)?.fingerprint ?? "";
}
