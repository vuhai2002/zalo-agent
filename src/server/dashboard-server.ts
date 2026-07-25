import fs from "node:fs";
import path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { env } from "../config/env.js";
import { createLogger } from "../shared/logger.js";
import {
  allowLoginAttempt,
  checkPassword,
  clearLoginAttempts,
  createSessionToken,
  verifySessionToken,
} from "./dashboard-auth.js";
import { contactRoutes } from "./routes/contact-routes.js";
import { memoryRoutes } from "./routes/memory-routes.js";
import { overviewRoutes } from "./routes/overview-routes.js";
import { providerRoutes } from "./routes/provider-routes.js";
import { threadRoutes } from "./routes/thread-routes.js";

const log = createLogger("dashboard-server");
const SESSION_COOKIE = "dashboard_session";

/** Tách buildApp khỏi serve() để test gọi app.request() không cần mở port */
export function buildDashboardApp(): Hono {
  const app = new Hono();

  // Liveness - không auth, không cache (theo healthcheck rules)
  app.get("/api/health", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    // Sau reverse proxy chỉ tin x-forwarded-for do Caddy tự set; local thì fallback
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!allowLoginAttempt(ip)) {
      return c.json({ error: "Thử quá nhiều lần, đợi 1 phút" }, 429);
    }

    const body = (await c.req.json().catch(() => null)) as { password?: string } | null;
    if (!body?.password || !checkPassword(body.password)) {
      return c.json({ error: "Sai mật khẩu" }, 401);
    }

    clearLoginAttempts(ip);
    setCookie(c, SESSION_COOKIE, createSessionToken(), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    setCookie(c, SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
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
  app.route("/api/overview", overviewRoutes);
  app.route("/api/threads", threadRoutes);
  app.route("/api/contacts", contactRoutes);
  app.route("/api/provider", providerRoutes);
  app.route("/api/memories", memoryRoutes);

  // Production: serve SPA đã build (pnpm build:web). Dev thì dùng Vite (pnpm dev:web).
  const webDist = path.resolve("web/dist");
  if (fs.existsSync(webDist)) {
    app.use("/*", serveStatic({ root: "web/dist" }));
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
