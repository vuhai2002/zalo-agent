import { datNguonToolMcp } from "../agent/tools/mcp-tool-provider.js";
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
 * NƠI DUY NHẤT giữ kết nối MCP sống (Map trong RAM). `mcpToolDefinitions`
 * (registry gọi mỗi lượt) chỉ đọc Map này - ĐỒNG BỘ, không chạm mạng/DB, nên
 * rỗng an toàn khi manager chưa `start` (vd test khác import registry mà
 * không cần MCP).
 *
 * Chiều phụ thuộc CỐ Ý một chiều: file này import store/binding/định nghĩa
 * tool, KHÔNG bao giờ import `tool-registry.ts` - registry mới là bên gọi
 * `mcpToolDefinitions`, import ngược sẽ tạo vòng.
 */
type ServerDangNoi = { ketNoi: KetNoiMcp; defs: ToolDefinition[] };
const dangNoi = new Map<string, ServerDangNoi>();

/** Chốt chống tái nhập cho `ketNoiLaiServer` - xem docstring ở đó. */
const dangNap = new Set<string>();

/** Seam test: 2 Map cấp module không tự dọn theo `beforeEach` xóa bảng DB. */
export function resetChoTest(): void {
  dangNoi.clear();
  dangNap.clear();
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
async function nap(id: string, luuMoc: boolean): Promise<void> {
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

/**
 * (Re)connect một server: đóng handle cũ (nếu có) rồi nối lại từ đầu. Lỗi ->
 * `loi`, KHÔNG ném.
 *
 * Chặn TÁI NHẬP qua `dangNap`: health tick (mỗi `MCP_HEALTH_INTERVAL_MS`) chỉ
 * nhắm server `loi`. Một lượt `nap` đang CHẠY DỞ (chưa kịp đổi trạng thái) vẫn
 * khớp điều kiện đó ở nhịp sau - không chặn thì mỗi nhịp chồng thêm một `nap`
 * song song lên CÙNG server, mở thêm một handle nữa mà `ngatServer` (chạy
 * trước `nap` của MỖI lời gọi) không biết đường đóng vì nó chưa kịp vào `dangNoi`.
 */
export async function ketNoiLaiServer(id: string): Promise<void> {
  if (dangNap.has(id)) return;
  dangNap.add(id);
  try {
    await ngatServer(id);
    try {
      await nap(id, false);
    } catch (e) {
      datTrangThaiServer(id, "loi", e instanceof Error ? e.message : String(e));
    }
  } finally {
    dangNap.delete(id);
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

/** Người vận hành đã xem bộ tool đổi và đồng ý: lấy bộ hiện tại LÀM MỐC mới rồi nạp. */
export async function duyetLaiDrift(id: string): Promise<void> {
  await ngatServer(id);
  try {
    await nap(id, true);
  } catch (e) {
    datTrangThaiServer(id, "loi", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Boot: nối mọi server `enabled` (1 server hỏng không chặn cái khác, và
 * không chặn tiến trình boot vì mỗi lời gọi tự bắt lỗi bên trong). Health
 * định kỳ chỉ thử nối lại server đang ở trạng thái `loi` - server `can_duyet_lai`
 * cố ý KHÔNG tự nối lại, phải chờ người vận hành gọi `duyetLaiDrift`.
 */
export function startMcpManager(): () => void {
  if (!getTuning("MCP_ENABLED")) return () => {};
  // Đăng ký nguồn NGAY để registry (qua lớp provider thuần) đọc được cache
  // của manager này - làm trước vòng nối để không có khe hở nào giữa lúc
  // manager đã "bật" và lúc registry còn thấy nguồn mặc định rỗng.
  datNguonToolMcp(mcpToolDefinitions);
  for (const s of danhSachServer()) if (s.enabled) void ketNoiLaiServer(s.id);
  const timer = setInterval(() => {
    for (const s of danhSachServer()) if (s.enabled && s.trangThai === "loi") void ketNoiLaiServer(s.id);
  }, getTuning("MCP_HEALTH_INTERVAL_MS"));
  timer.unref();
  return () => {
    clearInterval(timer);
    for (const id of [...dangNoi.keys()]) void ngatServer(id);
  };
}
