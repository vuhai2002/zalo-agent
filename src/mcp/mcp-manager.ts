import { datNguonToolMcp } from "../agent/tools/mcp-tool-provider.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import {
  datKetNoiServerChoTest,
  dongTatCaKetNoi,
  mcpToolDefinitions,
  nap,
  ngatServer,
  resetPoolChoTest,
  trangThaiCacServer,
} from "./mcp-connection-pool.js";
import { danhSachServer, datTrangThaiServer } from "./mcp-server-store.js";

/**
 * MẶT TIỀN công khai của module MCP: giữ chốt tái nhập `dangNap` + vòng
 * health/boot. Kết nối thật (Map `dangNoi`, hàm `nap`/`ngatServer`) sống ở
 * `mcp-connection-pool.ts` - tách ra để cả hai file dưới 200 dòng, ranh giới
 * là "biết KHI NÀO gọi nap" (ở đây) vs "biết CÁCH nối 1 server" (ở pool).
 *
 * Re-export 4 symbol dưới đây để nơi ĐANG import từ `mcp-manager.js`
 * (`mcp-routes.ts`, `mcp-manager.test.ts`) không phải sửa đường import khi
 * pool tách ra - với bên ngoài, module MCP vẫn là MỘT mặt tiền duy nhất.
 */
export { datKetNoiServerChoTest, mcpToolDefinitions, ngatServer, trangThaiCacServer };

/** Chốt chống tái nhập, DÙNG CHUNG cho `ketNoiLaiServer` VÀ `duyetLaiDrift` - xem docstring từng hàm. */
const dangNap = new Set<string>();

/** Seam test: Set ở đây + Map trong pool đều cấp module, không tự dọn theo `beforeEach` xóa bảng DB. */
export function resetChoTest(): void {
  dangNap.clear();
  resetPoolChoTest();
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

/**
 * Người vận hành đã xem bộ tool đổi và đồng ý: lấy bộ hiện tại LÀM MỐC mới rồi nạp.
 *
 * Dùng CHUNG chốt `dangNap` với `ketNoiLaiServer` (không phải Set riêng): cả
 * hai đều gọi `nap()` trên CÙNG một server, nên phải loại trừ lẫn nhau bất kể
 * gọi từ đường nào - tách hai Set riêng là hai khóa cho cùng một tài nguyên,
 * không chặn được race giữa chúng. Ca thật chốt này chặn: người vận hành
 * bấm "Duyệt lại" hai lần liên tiếp (double-click) trước khi lượt đầu kịp đổi
 * trạng thái. KHÔNG phải health tick - vòng health (`startMcpManager` bên
 * dưới) chỉ nhắm server đang ở trạng thái `loi`, không bao giờ nhắm
 * `can_duyet_lai` (trạng thái của server đang chờ duyệt drift).
 */
export async function duyetLaiDrift(id: string): Promise<void> {
  if (dangNap.has(id)) return;
  dangNap.add(id);
  try {
    await ngatServer(id);
    try {
      await nap(id, true);
    } catch (e) {
      datTrangThaiServer(id, "loi", e instanceof Error ? e.message : String(e));
    }
  } finally {
    dangNap.delete(id);
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
  // của pool này - làm trước vòng nối để không có khe hở nào giữa lúc manager
  // đã "bật" và lúc registry còn thấy nguồn mặc định rỗng.
  datNguonToolMcp(mcpToolDefinitions);
  for (const s of danhSachServer()) if (s.enabled) void ketNoiLaiServer(s.id);
  const timer = setInterval(() => {
    for (const s of danhSachServer()) if (s.enabled && s.trangThai === "loi") void ketNoiLaiServer(s.id);
  }, getTuning("MCP_HEALTH_INTERVAL_MS"));
  timer.unref();
  return () => {
    clearInterval(timer);
    dongTatCaKetNoi();
  };
}
