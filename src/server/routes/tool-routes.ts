import { Hono } from "hono";
import { getAccount } from "../../config/account-store.js";
import { kiemTraKhaDung } from "../../agent/tools/tool-registry.js";
import { z } from "zod";
import { TOOL_DEFINITIONS, type ToolScope } from "../../agent/tools/index.js";
import { getAgent } from "../../config/agent-store.js";
import {
  getFetchSettings,
  getSearchSettingsForApi,
  updateFetchSettings,
  updateSearchSettings,
} from "../../config/runtime-tool-settings.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("tool-routes");

const searchUpdateSchema = z.object({
  provider: z.enum(["duckduckgo", "brave"]).optional(),
  // Bỏ trống = giữ key cũ; chuỗi rỗng tường minh = xóa key. Key đi 1 chiều
  // lên server, lưu DB mã hóa, không bao giờ trả về nguyên văn.
  braveApiKey: z.string().optional(),
});

const fetchUpdateSchema = z.object({
  fallbackEnabled: z.boolean().optional(),
});

/**
 * Scope KHÔNG có agent thật - dùng khi GET /api/tools không kèm `agentId` (vd
 * trang Tools phạm vi tài khoản, không gắn với một agent cụ thể nào). Agent id
 * RỖNG là quy ước có chủ đích: `kb_search.available()` (tool-catalog-read.ts)
 * đọc thấy `scope.agent.id === ""` thì tự chuyển sang câu hỏi tầm rộng hơn
 * ("kho ĐÃ có nguồn nào chưa" thay vì "nguồn của agent nào") - xem
 * `kb-agent-binding.test.ts` cho bất biến `nguonCuaAgent("")` luôn rỗng, canh
 * cho quy ước này không bao giờ lẫn với một agent id thật.
 */
// Khung mặc định khi KHÔNG có agentId. `loai` thật do `dungScope` ghi đè theo
// `accountId` - giá trị ở đây chỉ là chỗ dựa khi cũng không có accountId.
const SCOPE_KHONG_CO_AGENT_THAT: ToolScope = {
  agent: { id: "", disabledTools: [] },
  account: { disabledTools: [], loai: "ca_nhan" },
};

/**
 * Dựng scope cho GET /api/tools. Có `agentId` hợp lệ (agent tồn tại) thì trả
 * scope THẬT của agent đó, để `kb_search.available()` trả lời đúng "agent NÀY
 * đã gán nguồn chưa" - thiếu bước này thì trang sửa agent (nơi vừa gán nguồn
 * xong) vẫn hiện "chưa dùng được", chỉ người vận hành sang đúng tab họ vừa rời.
 *
 * `agentId` không tồn tại (agent bị xóa giữa lúc trang đang mở, hay ai đó gõ
 * tay query param) trả `null` để caller trả 400 - KHÔNG rơi về ca "không
 * agent": im lặng đổi nghĩa "id sai" thành "không biết agent nào" là gài bẫy
 * cho lần debug sau, con số hiện ra vẫn "hợp lý" nhưng sai ngữ cảnh.
 */
function dungScope(agentId: string | undefined, accountId: string | undefined): ToolScope | null {
  // Loại kênh của ĐÚNG account đang xem. Thiếu bước này thì trang Tools chọn
  // một tài khoản bot xong vẫn hiện đủ 14 tool và "Gửi file" vẫn xanh - trong
  // khi model chạy trên tài khoản đó không hề nhận được nó. Đúng lớp lỗi mà cờ
  // `available` sinh ra để chặn, chỉ là ở trục kênh.
  // `accountId` trỏ tới account KHÔNG TỒN TẠI thì trả null để caller ra 400,
  // đúng như nhánh `agentId` ngay dưới - im lặng rơi về "ca_nhan" là gài bẫy
  // cho lần debug sau: trang Tools với một accountId cũ sẽ hiện đủ 14 tool
  // "dùng được" cho một tài khoản bot.
  const accCuThe = accountId ? getAccount(accountId) : undefined;
  if (accountId && !accCuThe) return null;
  const loai = accCuThe?.loai ?? "ca_nhan";
  if (!agentId) return { ...SCOPE_KHONG_CO_AGENT_THAT, account: { disabledTools: [], loai } };
  const agent = getAgent(agentId);
  if (!agent) return null;
  return {
    agent: { id: agent.id, disabledTools: agent.disabledTools },
    account: { disabledTools: [], loai },
  };
}

/**
 * /api/tools - catalog tool + cấu hình chuỗi nguồn cho web_search/web_fetch.
 * Một nguồn duy nhất từ tool-registry (giống reaction-icons) - frontend không
 * chép lại. Trạng thái bật/tắt tool per account nằm trong GET /api/accounts.
 *
 * `?agentId=` optional - trang sửa agent truyền vào để `available` phản ánh
 * đúng agent đang sửa; trang Tools (phạm vi tài khoản) không truyền.
 */
export const toolRoutes = new Hono()

  .get("/", (c) => {
    const scope = dungScope(c.req.query("agentId"), c.req.query("accountId"));
    // Nói ĐÚNG cái nào không tồn tại: `dungScope` trả null cho cả hai ca, mà
    // báo nhầm bảng là người debug đi tìm nhầm chỗ.
    if (!scope) {
      const thieuAccount = c.req.query("accountId") && !getAccount(c.req.query("accountId")!);
      return c.json({ error: thieuAccount ? "Account không tồn tại" : "Agent không tồn tại" }, 400);
    }

    return c.json({
      items: TOOL_DEFINITIONS.map((t) => {
        // available = hạ tầng đã sẵn sàng chưa (khác với bật/tắt per account).
        // Thiếu cờ này thì UI hiện tool bật sẵn trong khi model không hề nhận
        // được nó - người dùng tưởng bot có khả năng đó mà không có.
        const kq = kiemTraKhaDung(t, scope);
        const available = kq.khaDung;
        return {
          key: t.key,
          label: t.label,
          description: t.description,
          group: t.group,
          hasSettings: Boolean(t.hasSettings),
          available,
          unavailableHint: available ? undefined : kq.hint,
        };
      }),
      search: getSearchSettingsForApi(),
      fetch: getFetchSettings(),
    });
  })

  .patch("/search", async (c) => {
    const parsed = searchUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }

    try {
      const search = updateSearchSettings(parsed.data);
      // Audit: ghi field nào đổi, KHÔNG ghi giá trị key
      log.info(
        { provider: search.provider, changedKey: parsed.data.braveApiKey !== undefined },
        "Đổi cấu hình web search từ dashboard",
      );
      return c.json({ ok: true, search: getSearchSettingsForApi() });
    } catch (err) {
      // Chọn brave mà chưa có key - lỗi của người dùng, không phải lỗi server
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  })

  .patch("/fetch", async (c) => {
    const parsed = fetchUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }

    const fetchSettings = updateFetchSettings(parsed.data);
    log.info(fetchSettings, "Đổi cấu hình web fetch từ dashboard");
    return c.json({ ok: true, fetch: fetchSettings });
  });
