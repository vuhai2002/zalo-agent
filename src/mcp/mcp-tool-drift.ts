import { detectToolDrift, fingerprintTools, type ToolSet } from "ai";

/**
 * Chống server MCP đổi tool ngầm giữa hai lần kết nối ("rug pull" - đổi
 * description/schema của một tool đã được người vận hành duyệt, mà tên tool
 * không đổi nên không ai nhận ra nếu không so mốc).
 *
 * `fingerprintTools`/`detectToolDrift` là hàm sẵn có của `ai` (băm các trường
 * ảnh hưởng bảo mật: description, input schema, title) - không tự viết lại.
 */

/** Băm bộ tool hiện tại thành chuỗi JSON để lưu làm mốc đã duyệt. */
export async function chupFingerprint(tools: ToolSet): Promise<string> {
  return JSON.stringify(await fingerprintTools(tools));
}

/**
 * So bộ tool hiện tại với mốc đã lưu.
 *
 * Mốc rỗng (`""`, server chưa từng được duyệt) -> KHÔNG coi là drift, vì
 * "chưa có gì để so" khác với "đã so thấy khác" - caller (mcp-manager) tự lưu
 * mốc đầu tiên trong nhánh này.
 */
export async function soDrift(
  tools: ToolSet,
  mocJson: string,
): Promise<{ drift: boolean; them: string[]; doi: string[]; bo: string[] }> {
  if (!mocJson) return { drift: false, them: [], doi: [], bo: [] };
  const current = await fingerprintTools(tools);
  const baseline = JSON.parse(mocJson) as Record<string, string>;
  const { added, removed, changed } = detectToolDrift(current, baseline);
  return { drift: added.length + removed.length + changed.length > 0, them: added, doi: changed, bo: removed };
}
