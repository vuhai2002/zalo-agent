import { db } from "./database.js";

/**
 * Cache mô tả ảnh của vision sidecar (bảng image_descriptions). Mỗi ảnh trong
 * data/media chỉ được mô tả MỘT lần - các lượt sau (kể cả nạp lại từ history)
 * đọc cache, không gọi lại sidecar, không tốn quota. Học cache theo sha256 của
 * Hermes; mình key theo rel_path vì mỗi file media đã có đường dẫn duy nhất.
 */

const getStmt = db.prepare("SELECT description FROM image_descriptions WHERE rel_path = ?");
const setStmt = db.prepare(`
  INSERT INTO image_descriptions (rel_path, description, model)
  VALUES (?, ?, ?)
  ON CONFLICT (rel_path) DO UPDATE SET description = excluded.description, model = excluded.model
`);
const pruneStmt = db.prepare("DELETE FROM image_descriptions WHERE created_at < ?");

export function getImageDescription(relPath: string): string | null {
  const row = getStmt.get(relPath) as { description: string } | undefined;
  return row?.description ?? null;
}

export function saveImageDescription(relPath: string, description: string, model: string): void {
  setStmt.run(relPath, description, model);
}

/**
 * Dọn mô tả cũ hơn N ngày - cùng nhịp với dọn file media để hai bên kể cùng
 * một câu chuyện: quá hạn thì cả pixel lẫn mô tả đều rơi về text "[gửi kèm N ảnh]".
 * Trả về số row đã xóa.
 */
const deleteByPathStmt = db.prepare("DELETE FROM image_descriptions WHERE rel_path = ?");

/**
 * Xóa mô tả của đúng những ảnh này. Nhận danh sách đường dẫn vì bảng chỉ khóa
 * theo `rel_path` - không có cột account/thread để lọc, nên caller phải lấy
 * danh sách từ `xoaMediaCuaThread` rồi truyền vào.
 */
export function xoaMoTaAnhTheoDuongDan(relPaths: string[]): number {
  let n = 0;
  for (const p of relPaths) n += Number(deleteByPathStmt.run(p).changes);
  return n;
}

export function pruneExpiredImageDescriptions(retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return Number(pruneStmt.run(cutoff).changes);
}
