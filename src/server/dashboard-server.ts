import fs from "node:fs";
import path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { env } from "../config/env.js";
import { createLogger } from "../shared/logger.js";
import { resolveClientIp } from "./client-ip.js";
import {
  allowLoginAttempt,
  checkPassword,
  clearLoginAttempts,
  createSessionToken,
  revokeSessionToken,
  verifySessionToken,
} from "./dashboard-auth.js";
import { setStoredPassword } from "./dashboard-password-store.js";
import { accountRoutes } from "./routes/account-routes.js";
import { agentRoutes } from "./routes/agent-routes.js";
import { contactRoutes } from "./routes/contact-routes.js";
import { logRoutes } from "./routes/log-routes.js";
import { memoryRoutes } from "./routes/memory-routes.js";
import { overviewRoutes } from "./routes/overview-routes.js";
import { providerRoutes } from "./routes/provider-routes.js";
import { scheduleRoutes } from "./routes/schedule-routes.js";
import { threadRoutes } from "./routes/thread-routes.js";
import { imageRoutes } from "./routes/image-routes.js";
import { toolRoutes } from "./routes/tool-routes.js";
import { traceRoutes } from "./routes/trace-routes.js";
import { tuningRoutes } from "./routes/tuning-routes.js";
import { visionRoutes } from "./routes/vision-routes.js";

const log = createLogger("dashboard-server");
const SESSION_COOKIE = "dashboard_session";

/**
 * `secure` chỉ bật khi đứng sau proxy HTTPS: bật lúc chạy http://127.0.0.1 thì
 * trình duyệt không gửi cookie và không ai đăng nhập được.
 */
const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  secure: env.DASHBOARD_BEHIND_PROXY,
};

/**
 * Cache cho file tĩnh. Vite đặt hash vào tên file trong /assets/ nên cache
 * vĩnh viễn được; ảnh trong public/ giữ nguyên tên nên chỉ cache 1 ngày để
 * đổi logo không phải bảo user xóa cache. index.html không bao giờ cache -
 * nó là thứ trỏ tới bundle mới sau mỗi lần deploy.
 */
const setStaticCacheHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.ok) return;
  const p = c.req.path;
  if (p.startsWith("/assets/")) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  } else if (/\.(webp|png|jpg|jpeg|svg|ico|woff2?)$/i.test(p)) {
    c.header("Cache-Control", "public, max-age=86400");
  } else {
    c.header("Cache-Control", "no-cache");
  }
};

/** Tách buildApp khỏi serve() để test gọi app.request() không cần mở port */
export function buildDashboardApp(): Hono {
  const app = new Hono();

  // Liveness - không auth, không cache (theo healthcheck rules)
  app.get("/api/health", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    const ip = resolveClientIp(c);
    if (!allowLoginAttempt(ip)) {
      return c.json({ error: "Thử quá nhiều lần, đợi 1 phút" }, 429);
    }

    const body = (await c.req.json().catch(() => null)) as { password?: string } | null;
    if (!body?.password || !checkPassword(body.password)) {
      return c.json({ error: "Sai mật khẩu" }, 401);
    }

    clearLoginAttempts(ip);
    setCookie(c, SESSION_COOKIE, createSessionToken(), {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60,
    });
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    // Xóa phiên trong DB, không chỉ xóa cookie ở client
    revokeSessionToken(getCookie(c, SESSION_COOKIE));
    setCookie(c, SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return c.json({ ok: true });
  });

  // Mọi API sau điểm này yêu cầu session hợp lệ
  app.use("/api/*", async (c, next) => {
    if (!verifySessionToken(getCookie(c, SESSION_COOKIE))) {
      return c.json({ error: "Chưa đăng nhập" }, 401);
    }
    await next();
  });

  app.get("/api/auth/me", (c) => c.json({ ok: true }));

  /**
   * Đổi mật khẩu. BẮT BUỘC nhập lại mật khẩu hiện tại dù đã đăng nhập: cookie
   * bị mượn (máy bỏ quên, XSS) mà đổi được mật khẩu là khoá luôn chủ thật ra
   * ngoài. Vẫn tính vào rate-limit login vì đây là một chỗ đoán mật khẩu nữa.
   *
   * Đổi xong mọi phiên cũ hết hiệu lực (fingerprint đổi theo), nên cấp lại
   * cookie mới ngay cho chính người vừa đổi - không thì họ bị đá ra khỏi trang
   * mình đang đứng.
   */
  app.post("/api/auth/password", async (c) => {
    const ip = resolveClientIp(c);
    if (!allowLoginAttempt(ip)) {
      return c.json({ error: "Thử quá nhiều lần, đợi 1 phút" }, 429);
    }

    const body = (await c.req.json().catch(() => null)) as
      | { currentPassword?: string; newPassword?: string }
      | null;
    const hienTai = body?.currentPassword ?? "";
    const moi = body?.newPassword ?? "";

    if (!checkPassword(hienTai)) {
      return c.json({ error: "Mật khẩu hiện tại không đúng" }, 401);
    }
    // Khớp đúng ràng buộc của schema env - hai nơi lệch nhau thì đổi qua web
    // được một giá trị mà đặt trong .env lại bị từ chối lúc boot
    if (moi.length < 8) {
      return c.json({ error: "Mật khẩu mới phải từ 8 ký tự" }, 400);
    }
    if (moi === hienTai) {
      return c.json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại" }, 400);
    }

    clearLoginAttempts(ip);
    setStoredPassword(moi);
    // Phiên cũ (kể cả của chính người này) đã vô hiệu vì fingerprint đổi - cấp
    // cookie mới để họ đi tiếp, các thiết bị khác thì phải đăng nhập lại
    setCookie(c, SESSION_COOKIE, createSessionToken(), {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60,
    });
    log.warn("Mật khẩu dashboard đã đổi - mọi phiên đăng nhập khác bị thu hồi");
    return c.json({ ok: true });
  });
  app.route("/api/overview", overviewRoutes);
  app.route("/api/threads", threadRoutes);
  app.route("/api/contacts", contactRoutes);
  app.route("/api/provider", providerRoutes);
  app.route("/api/memories", memoryRoutes);
  app.route("/api/accounts", accountRoutes);
  app.route("/api/agents", agentRoutes);
  app.route("/api/tools", toolRoutes);
  app.route("/api/tuning", tuningRoutes);
  app.route("/api/vision", visionRoutes);
  app.route("/api/image-gen", imageRoutes);
  app.route("/api/traces", traceRoutes);
  app.route("/api/logs", logRoutes);
  app.route("/api/schedule", scheduleRoutes);

  // API không khớp route nào phải trả JSON 404, không được rơi xuống SPA
  // fallback bên dưới (client fetch JSON mà nhận HTML thì lỗi rất khó đọc)
  app.all("/api/*", (c) => c.json({ error: "Không tìm thấy endpoint" }, 404));

  // Production: serve SPA đã build (pnpm build:web). Dev thì dùng Vite (pnpm dev:web).
  // Fallback index.html cho mọi path còn lại để deep link (/sessions, /login)
  // load được khi F5 - đây là điều kiện để router dùng URL sạch, không cần hash.
  if (fs.existsSync(path.resolve("web/dist"))) {
    app.use("/*", setStaticCacheHeaders, serveStatic({ root: "web/dist" }));
    app.get("*", serveStatic({ path: "web/dist/index.html" }));
  }

  return app;
}

let server: ServerType | undefined;

/** Không set DASHBOARD_PASSWORD = không mở server (an toàn mặc định) */
export function startDashboardServer(): void {
  if (!env.DASHBOARD_PASSWORD) {
    log.warn("DASHBOARD_PASSWORD chưa set - dashboard tắt");
    return;
  }
  server = serve(
    { fetch: buildDashboardApp().fetch, port: env.DASHBOARD_PORT, hostname: "127.0.0.1" },
    (info) => log.info({ port: info.port }, "Dashboard sẵn sàng tại http://127.0.0.1:" + info.port),
  );
}

export function stopDashboardServer(): void {
  server?.close();
  server = undefined;
}
