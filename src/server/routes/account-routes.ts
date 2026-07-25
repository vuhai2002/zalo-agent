import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { TOOL_KEYS } from "../../agent/tools/index.js";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "../../config/account-store.js";
import { getAgent } from "../../config/agent-store.js";
import { dataDir } from "../../config/env.js";
import { createLogger } from "../../shared/logger.js";
import { isAccountRunning, startAccount, stopAccount } from "../../zalo/account-manager.js";
import { getQrLoginStatus, startQrLogin } from "../../zalo/qr-login-manager.js";
import { REACTION_ICON_KEYS, REACTION_ICONS } from "../../zalo/reaction-icons.js";
import { hasCredentials } from "../../zalo/zalo-credential-store.js";

const log = createLogger("account-routes");

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id phải là kebab-case");

const createSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(100),
  agentId: z.string().optional(),
});

const patchSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  agentId: z.string().optional(),
  allowlist: z
    .object({ mode: z.enum(["all", "list"]), userIds: z.array(z.string()) })
    .optional(),
  groupRequireMention: z.boolean().optional(),
  respondToGroups: z.boolean().optional(),
  groupPassiveListen: z.boolean().optional(),
  autoReactEnabled: z.boolean().optional(),
  // Chặn icon lạ ngay ở API thay vì để rơi về mặc định lúc chạy
  autoReactIcon: z.enum(REACTION_ICON_KEYS as [string, ...string[]]).optional(),
  typingIndicatorEnabled: z.boolean().optional(),
  // Chặn key tool lạ ngay ở API - key sai âm thầm nằm trong DB sẽ không tắt gì cả
  disabledTools: z.array(z.enum(TOOL_KEYS as [string, ...string[]])).optional(),
});

const withStatus = (a: ReturnType<typeof listAccounts>[number]) => ({
  ...a,
  running: isAccountRunning(a.id),
  hasCredentials: hasCredentials(a.id),
});

/** /api/accounts - quản lý tài khoản Zalo từ dashboard (DB là source of truth) */
export const accountRoutes = new Hono()

  .get("/", (c) => c.json({ items: listAccounts().map(withStatus) }))

  // Danh sách reaction cho UI chọn - giữ 1 nguồn duy nhất ở server, tránh
  // frontend chép lại rồi lệch. Đặt trước route /:id để không bị nuốt.
  .get("/reaction-icons", (c) =>
    c.json({
      items: REACTION_ICON_KEYS.map((key) => ({
        key,
        emoji: REACTION_ICONS[key].emoji,
        label: REACTION_ICONS[key].label,
      })),
    }),
  )

  .post("/", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    if (getAccount(parsed.data.id)) return c.json({ error: "Account id đã tồn tại" }, 409);
    if (parsed.data.agentId && !getAgent(parsed.data.agentId)) {
      return c.json({ error: "Agent không tồn tại" }, 400);
    }

    const account = createAccount(parsed.data);
    log.info({ accountId: account.id }, "Tạo account từ dashboard");
    return c.json({ account: withStatus(account) }, 201);
  })

  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    if (parsed.data.agentId && !getAgent(parsed.data.agentId)) {
      return c.json({ error: "Agent không tồn tại" }, 400);
    }

    const account = updateAccount(id, parsed.data);
    if (!account) return c.json({ error: "Account không tồn tại" }, 404);

    // Toggle enabled tác động listener ngay; start fail (chưa login QR) không
    // phải lỗi của PATCH - trả warning để UI hiện, account vẫn ở trạng thái bật
    let warning: string | undefined;
    if (parsed.data.enabled === false) {
      stopAccount(id);
    } else if (parsed.data.enabled === true && !isAccountRunning(id)) {
      try {
        await startAccount(id);
      } catch (err) {
        warning = `Chưa chạy được: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return c.json({ account: withStatus(account), warning });
  })

  // Bắt đầu phiên login QR (idempotent - đang có phiên sống thì trả phiên đó)
  .post("/:id/login", (c) => {
    const id = c.req.param("id");
    if (!getAccount(id)) return c.json({ error: "Account không tồn tại" }, 404);
    startQrLogin(id);
    return c.json(getQrLoginStatus(id));
  })

  // UI polling mỗi ~1.5s: trạng thái + ảnh QR (data URI) khi đang chờ quét
  .get("/:id/login/status", (c) => c.json(getQrLoginStatus(c.req.param("id"))))

  .delete("/:id", (c) => {
    const id = c.req.param("id");
    stopAccount(id);
    if (!deleteAccount(id)) return c.json({ error: "Account không tồn tại" }, 404);

    // Xóa luôn credentials (cookie mã hóa) - account đã xóa thì không giữ chìa khóa.
    // History/contacts giữ lại để còn tra cứu.
    fs.rmSync(path.join(dataDir, "accounts", id), { recursive: true, force: true });
    log.info({ accountId: id }, "Xóa account + credentials từ dashboard");
    return c.json({ ok: true });
  });
