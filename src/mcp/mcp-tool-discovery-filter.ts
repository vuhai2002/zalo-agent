import { asSchema, type Tool } from "ai";
import { locKyTuAn } from "../agent/tools/tag-ky-tu-an.js";

/**
 * Sàng bộ tool vừa khám phá từ MỘT server MCP trước khi nó được tính mốc
 * drift hay dựng thành `ToolDefinition`. Server ngoài tự khai danh sách tool
 * nên không có gì đảm bảo danh sách đó gửi được lên provider:
 *
 *   - `inputSchema` không phải JSON schema `type:"object"`: API function
 *     calling chỉ nhận tham số dạng object, MỘT tool lệch là provider trả 400
 *     cho MỌI lượt của agent được gán server đó - không riêng tool lỗi. Lib
 *     (`@ai-sdk/mcp`) để lọt vì schema của nó khai `type: z.optional(z.unknown())`.
 *   - Số tool không trần: 128 là trần tool mỗi request của OpenAI, và một
 *     server khai vài nghìn tool thì schema gửi model phình theo mà không ai
 *     chọn. Hằng số chứ không phải tham số dashboard: vượt nó thì provider từ
 *     chối, không có giá trị nào lớn hơn mà vẫn đúng.
 *
 * Giữ THỨ TỰ server trả để snapshot trên dashboard không đổi chỗ. Lọc TRƯỚC
 * khi chụp fingerprint: thứ người vận hành duyệt phải đúng là thứ được nạp -
 * một tool hôm nay bị loại mà mai hợp lệ thì hiện ra như tool MỚI và đòi duyệt.
 *
 * KHÔNG log (cả `src/mcp` cố ý không có dòng log nào): số tool bị bỏ trả về
 * cho caller ghi vào trạng thái server. Không kèm TÊN tool - tên do server
 * đặt, chỉ cần con số để người vận hành biết mà đi xem.
 */

export const TRAN_SO_TOOL_MOT_SERVER = 128;

export type KetQuaLocTool = { hopLe: Record<string, Tool>; saiSchema: number; vuotTran: number };

async function laSchemaObject(t: Tool): Promise<boolean> {
  try {
    const js = await asSchema(t.inputSchema).jsonSchema;
    return !!js && typeof js === "object" && js.type === "object";
  } catch {
    // Schema dựng không nổi thì càng không gửi được lên provider.
    return false;
  }
}

export async function locToolKhamPha(tools: Record<string, Tool>, tran = TRAN_SO_TOOL_MOT_SERVER): Promise<KetQuaLocTool> {
  const hopLe: Record<string, Tool> = {};
  let soHopLe = 0;
  let saiSchema = 0;
  let vuotTran = 0;
  for (const [ten, t] of Object.entries(tools)) {
    if (!(await laSchemaObject(t))) saiSchema += 1;
    else if (soHopLe >= tran) vuotTran += 1;
    else {
      hopLe[ten] = t;
      soHopLe += 1;
    }
  }
  return { hopLe, saiSchema, vuotTran };
}

/** Câu ghi kèm trạng thái server khi có tool bị bỏ; rỗng nếu không bỏ gì. */
export function ghiChuToolBiBo(kq: KetQuaLocTool): string {
  const phan: string[] = [];
  if (kq.saiSchema) phan.push(`${kq.saiSchema} tool có tham số không phải object`);
  if (kq.vuotTran) phan.push(`${kq.vuotTran} tool vượt trần ${TRAN_SO_TOOL_MOT_SERVER} tool/server`);
  return phan.length ? `Đã bỏ qua ${phan.join(", ")}` : "";
}

/**
 * Mô tả tool để đưa model (và lưu snapshot cho dashboard).
 *
 * `Tool.description` của `ai` SDK cho phép mô tả ĐỘNG - một hàm nhận context
 * runtime (của LƯỢT AGENT đang chạy) để sinh mô tả theo tình huống. Lúc khám
 * phá tool (nối server, CHƯA có lượt nào đang chạy) không có context đó để
 * gọi hàm, nên chỉ lấy được nhánh mô tả TĨNH (chuỗi) - đúng dạng mọi MCP
 * server thật sự trả về (`tools/list` của giao thức MCP chỉ có description
 * dạng chuỗi; nhánh hàm chỉ tồn tại ở KIỂU của `ai` SDK).
 *
 * Lọc dải Tags (`locKyTuAn`): mô tả đi thẳng vào schema model, là chỗ DUY
 * NHẤT chữ của server tới model mà KHÔNG có ranh giới `wrapUntrustedContent`
 * bao quanh (bản chất cơ chế tool) - chỉ thị giấu bằng ký tự vô hình ở đây
 * người vận hành duyệt trên dashboard không thấy gì.
 */
export function moTaAnToan(d: unknown): string {
  return typeof d === "string" ? locKyTuAn(d) : "";
}
