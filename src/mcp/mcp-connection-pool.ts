import type { ToolDefinition } from "../agent/tools/tool-catalog-types.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { serversCuaAgent } from "./mcp-agent-binding.js";
import { ketNoiServer, type KetNoiMcp } from "./mcp-client-connect.js";
import {
  danhSachServer,
  datTrangThaiServer,
  layFingerprint,
  layServerNoiBo,
  luuSnapshotFingerprint,
} from "./mcp-server-store.js";
import { goiCoTimeout, taoToolDefinitionMcp } from "./mcp-tool-definition.js";
import { chupFingerprint, soDrift } from "./mcp-tool-drift.js";
import type { McpToolInfo, TrangThaiServer } from "./mcp-types.js";

/**
 * Pool kết nối MCP: NƠI DUY NHẤT giữ client sống (Map trong RAM) + hàm `nap`
 * (nối/khám phá tool/kiểm drift/dựng `ToolDefinition`). Tách khỏi
 * `mcp-manager.ts` (giữ chốt tái nhập `dangNap` + vòng health) để cả hai file
 * dưới 200 dòng - ranh giới: file này KHÔNG biết gì về khóa `dangNap`, chỉ
 * biết "nối 1 server" và "đang có những kết nối nào"; `mcp-manager.ts` mới
 * quyết định KHI NÀO gọi `nap`/`ngatServer` và lặp health.
 *
 * `mcpToolDefinitions` (registry gọi mỗi lượt) chỉ đọc Map `dangNoi` - ĐỒNG
 * BỘ, không chạm mạng/DB, nên rỗng an toàn khi manager chưa `start` (vd test
 * khác import registry mà không cần MCP).
 *
 * Chiều phụ thuộc CỐ Ý một chiều: file này import store/binding/định nghĩa
 * tool, KHÔNG bao giờ import `tool-registry.ts` - registry mới là bên gọi
 * `mcpToolDefinitions`, import ngược sẽ tạo vòng.
 */
type ServerDangNoi = { ketNoi: KetNoiMcp; defs: ToolDefinition[] };
const dangNoi = new Map<string, ServerDangNoi>();

/** Seam test: Map cấp module không tự dọn theo `beforeEach` xóa bảng DB. */
export function resetPoolChoTest(): void {
  dangNoi.clear();
}

/**
 * `Tool.description` của `ai` SDK cho phép mô tả ĐỘNG - một hàm nhận context
 * runtime (của LƯỢT AGENT đang chạy) để sinh mô tả theo tình huống. Lúc khám
 * phá tool (nối server, CHƯA có lượt nào đang chạy) không có context đó để
 * gọi hàm, nên chỉ lấy được nhánh mô tả TĨNH (chuỗi) - đúng dạng mọi MCP
 * server thật sự trả về (`tools/list` của giao thức MCP chỉ có description
 * dạng chuỗi; nhánh hàm chỉ tồn tại ở KIỂU của `ai` SDK, không xuất hiện lúc
 * chạy với tool khám phá qua `@ai-sdk/mcp`).
 */
function moTaAnToan(d: unknown): string {
  return typeof d === "string" ? d : "";
}

let ketNoiFn: typeof ketNoiServer = ketNoiServer;
/** Seam test: tiêm hàm nối giả thay vì gọi HTTP thật (Phase 05 test cũng dùng tên này). */
export function datKetNoiServerChoTest(fn: typeof ketNoiServer): void {
  ketNoiFn = fn;
}

/** Tool của server ĐÃ NỐI (có trong `dangNoi`) VÀ ĐÃ GÁN cho agent này. */
export function mcpToolDefinitions(agentId: string): ToolDefinition[] {
  const daGan = new Set(serversCuaAgent(agentId));
  const ra: ToolDefinition[] = [];
  for (const [id, s] of dangNoi) if (daGan.has(id)) ra.push(...s.defs);
  return ra;
}

/** Trạng thái cho dashboard: mọi server trong DB (kể cả chưa nối/lỗi), kèm số tool đang cache. */
export function trangThaiCacServer(): { serverId: string; trangThai: TrangThaiServer; soTool: number; loi: string }[] {
  return danhSachServer().map((s) => ({
    serverId: s.id,
    trangThai: s.trangThai,
    soTool: dangNoi.get(s.id)?.defs.length ?? 0,
    loi: s.loi,
  }));
}

/**
 * Nối + khám phá tool + kiểm drift + dựng `ToolDefinition`, rồi nạp vào cache.
 *
 * `luuMoc=true` (chỉ từ `duyetLaiDrift`) BỎ QUA kiểm drift và LUÔN ghi đè mốc
 * bằng bộ tool hiện tại - đúng ngữ nghĩa "người vận hành vừa xem và duyệt bộ
 * mới". `luuMoc=false` (nối lại thường) mới so mốc; nếu server CHƯA từng có
 * mốc (lần đầu) thì vẫn phải lưu - không thì mọi lần sau đều "chưa mốc" và
 * không bao giờ bắt được drift.
 */
export async function nap(id: string, luuMoc: boolean): Promise<void> {
  const cfg = layServerNoiBo(id);
  if (!cfg) return;
  const ketNoi = await ketNoiFn({
    url: cfg.url,
    headers: cfg.headers,
    connectTimeoutMs: getTuning("MCP_CONNECT_TIMEOUT_MS"),
  });
  try {
    // `ketNoiFn` chỉ bọc trần cho BẮT TAY (`createMCPClient`) - khám phá tool
    // (`tools()`, tương đương `tools/list`) là một round-trip mạng RIÊNG sau
    // đó, không nằm trong trần đấy. Thiếu trần ở đây, một server qua được bắt
    // tay rồi treo lúc liệt kê tool giữ `nap` sống vô hạn; vì trạng thái
    // KHÔNG kịp đổi, mỗi nhịp health lại gọi `nap` thêm lần nữa, GHI ĐÈ
    // `dangNoi` mà không đóng handle cũ -> rò kết nối tích lũy.
    const tools = await goiCoTimeout(() => ketNoi.tools(), getTuning("MCP_CONNECT_TIMEOUT_MS"));
    if (!luuMoc) {
      const kq = await soDrift(tools, layFingerprint(id));
      if (kq.drift) {
        await ketNoi.close();
        datTrangThaiServer(id, "can_duyet_lai", `Bộ tool đổi (thêm ${kq.them.length}, đổi ${kq.doi.length}, bỏ ${kq.bo.length})`);
        return;
      }
    }
    const defs = Object.entries(tools).map(([ten, aiTool]) =>
      taoToolDefinitionMcp({
        serverId: id,
        serverTen: cfg.ten,
        toolTen: ten,
        moTa: moTaAnToan(aiTool.description),
        aiTool,
        toolCallTimeoutMs: getTuning("MCP_TOOL_TIMEOUT_MS"),
        // Cửa gán (Phase 03 nhận tiêm để lõi tool-definition không phải chạm DB).
        kiemGan: (agentId) => serversCuaAgent(agentId).includes(id),
      }),
    );
    if (luuMoc || layFingerprint(id) === "") {
      const snapshot: McpToolInfo[] = Object.entries(tools).map(([ten, t]) => ({ ten, moTa: moTaAnToan(t.description) }));
      luuSnapshotFingerprint(id, snapshot, await chupFingerprint(tools));
    }
    dangNoi.set(id, { ketNoi, defs });
    datTrangThaiServer(id, "da_ket_noi");
  } catch (e) {
    // Bất kỳ lỗi nào SAU khi đã có handle (kể cả tools() hết giờ) phải đóng
    // nó trước khi ném tiếp, không thì `dangNoi` (nơi duy nhất `ngatServer`
    // biết để đóng sau này) chưa từng thấy handle này - rò vĩnh viễn.
    await ketNoi.close().catch(() => {});
    throw e;
  }
}

/** Đóng client + xóa khỏi cache (gọi khi xóa/tắt server, hoặc trước khi nối lại). */
export async function ngatServer(id: string): Promise<void> {
  const s = dangNoi.get(id);
  if (!s) return;
  dangNoi.delete(id);
  try {
    await s.ketNoi.close();
  } catch {
    /* đóng lỗi không phải việc caller cần xử lý */
  }
}

/** Đóng TOÀN BỘ kết nối đang mở - dùng cho stop fn của `startMcpManager` lúc shutdown. */
export function dongTatCaKetNoi(): void {
  for (const id of [...dangNoi.keys()]) void ngatServer(id);
}
