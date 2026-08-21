import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { taoZaloBotClient } from "../../zalo-bot/zalo-bot-api-client.js";
import { TOOL_KEYS } from "../../agent/tools/index.js";
import {
  createAccount,
  deleteAccount,
  datBotToken,
  datLoaiKenh,
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
  /**
   * Loại kênh, chốt LÚC TẠO và không đổi được sau đó. Đổi loại của một tài
   * khoản đang chạy là đổi luôn ý nghĩa của credential đã lưu (cookie zca-js
   * so với token bot) - dễ thành một tài khoản nửa nọ nửa kia mà không ai
   * nhận ra. Muốn đổi thì xóa và tạo lại.
   */
  loai: z.enum(["ca_nhan", "bot"]).default("ca_nhan"),
});

const botTokenSchema = z.object({
  // Token Zalo Bot dạng `<id số>:<bí mật>`. Kiểm hình dạng ở đây để lỗi dán
  // nhầm (dán cả câu thông báo, thiếu một nửa) hiện ra ngay thay vì thành một
  // bot im lặng không rõ vì sao.
  // `min(10)` chứ không phải một con số cụ thể hơn: regex đã gánh phần hình
  // dạng, còn độ dài thật thì Zalo không công bố. Token đo được dài 82 ký tự,
  // nhưng lấy đó làm sàn là chặn nhầm nếu Zalo phát token ngắn hơn - người
  // dùng sẽ nhận "Dữ liệu không hợp lệ" cho một token hoàn toàn đúng.
  token: z.string().min(10).max(500).regex(/^\d+:[A-Za-z0-9_-]+$/, "Token không đúng định dạng <id>:<bí mật>"),
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
/**
 * Nhà máy dựng client Zalo Bot, tiêm được để test không đi ra mạng.
 *
 * Cùng khuôn `fetchImpl` của `image-generation-client.ts`. Không có điểm tiêm
 * này thì ca "token sai không được lưu" phải gọi API thật - và nó XANH y hệt
 * khi máy không có mạng, tức chứng minh đúng số không (đo: 94ms có mạng, 2,4ms
 * khi fetch ném, cả hai xanh).
 */
let taoClient = taoZaloBotClient;

/** Chỉ test dùng - đổi nhà máy client rồi trả hàm khôi phục */
export function tiemClientBotChoTest(gia: typeof taoZaloBotClient): () => void {
  const cu = taoClient;
  taoClient = gia;
  return () => {
    taoClient = cu;
  };
}

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
    if (parsed.data.loai === "bot") {
      datLoaiKenh(account.id, "bot");
      // Tài khoản bot mặc định ĐÓNG danh sách cho phép, khác tài khoản cá nhân.
      // Bán kính khác hẳn: nick cá nhân phải là bạn bè mới nhắn được, còn bot
      // thì ai có link cũng nhắn được - mở sẵn là mời người lạ đốt token và thử
      // prompt injection. Chủ bot tự thêm mình vào danh sách.
      updateAccount(account.id, { allowlist: { mode: "list", userIds: [] } });
    }
    log.info({ accountId: account.id, loai: parsed.data.loai }, "Tạo account từ dashboard");
    return c.json({ account: withStatus(getAccount(account.id)!) }, 201);
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
    const acc = getAccount(id);
    if (!acc) return c.json({ error: "Account không tồn tại" }, 404);
    // Đăng nhập QR cho một tài khoản BOT tạo ra đúng thứ `createSchema` nói
    // muốn tránh: `attachAccount` giết vòng poll rồi gắn api zca-js vào một
    // account mà DB nói là bot. Kết quả là tài khoản nửa nọ nửa kia - gửi được
    // file, nhưng `buildAgentTools` vẫn đọc `loai: "bot"` nên ẩn 7 tool và
    // persona vẫn dạy model nói "tài khoản bot không gửi được file".
    // Giao diện đã ẩn nút, nhưng đó là lớp client.
    if (acc.loai === "bot") {
      return c.json({ error: "Tài khoản bot không đăng nhập QR - nhập token ở phần Sửa" }, 400);
    }
    startQrLogin(id);
    return c.json(getQrLoginStatus(id));
  })

  // UI polling mỗi ~1.5s: trạng thái + ảnh QR (data URI) khi đang chờ quét
  .get("/:id/login/status", (c) => c.json(getQrLoginStatus(c.req.param("id"))))

  /**
   * Lưu token bot. Đường RIÊNG chứ không nhét vào PATCH: token là bí mật, và
   * `updateAccount` cố ý không nhận nó (xem docstring ở `account-store.ts`).
   *
   * KIỂM token với API thật trước khi lưu. Token sai mà cứ lưu thì triệu chứng
   * duy nhất là bot im lặng - không lỗi, không log ai đọc, gần như không đoán ra.
   */
  .put("/:id/bot-token", async (c) => {
    const id = c.req.param("id");
    const account = getAccount(id);
    if (!account) return c.json({ error: "Account không tồn tại" }, 404);
    if (account.loai !== "bot") return c.json({ error: "Chỉ tài khoản loại bot mới cần token" }, 400);

    const parsed = botTokenSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);

    // `try` CHỈ bọc lời gọi kiểm token. Bọc luôn `datBotToken` thì lỗi ghi DB
    // bị báo thành "Token không dùng được", và người vận hành đi tạo lại token
    // mãi trong khi token hoàn toàn đúng.
    let me: { id: string; display_name?: string };
    try {
      me = await taoClient({ token: parsed.data.token }).getMe();
    } catch (err) {
      // KHÔNG lưu khi kiểm hỏng. Lưu một token sai là dựng sẵn một tài khoản
      // trông như đã cấu hình xong mà không bao giờ chạy - triệu chứng duy nhất
      // là bot im lặng.
      log.warn({ accountId: id, err }, "Token bot không dùng được - không lưu");
      return c.json({ error: "Token không dùng được - kiểm lại token Zalo Bot Manager gửi cho bạn" }, 400);
    }

    datBotToken(id, parsed.data.token);
    log.info({ accountId: id, bot: me.display_name ?? me.id }, "Đã lưu token bot");

    // Lưu xong phải KHỞI ĐỘNG LẠI, không thì token mới không có hiệu lực:
    // - Account mới tạo có `enabled = 1` sẵn nhưng chưa chạy; nút gạt trên
    //   dashboard đã ở trạng thái BẬT nên người dùng phải bấm tắt rồi bật lại
    //   mới lên sóng - không ai đoán ra.
    // - Account ĐANG chạy thì vòng poll giữ client cũ (token đóng gói lúc tạo
    //   client), nên đổi token vì lộ token cũ mà không restart là vô nghĩa.
    let warning: string | undefined;
    if (account.enabled) {
      stopAccount(id);
      try {
        await startAccount(id);
      } catch (err) {
        warning = err instanceof Error ? err.message : "Không khởi động được account";
        log.warn({ accountId: id, err }, "Lưu token xong nhưng không khởi động được");
      }
    }

    return c.json({ ok: true, botName: me.display_name ?? me.id, ...(warning ? { warning } : {}) });
  })

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
