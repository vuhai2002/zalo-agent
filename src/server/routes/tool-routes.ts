import { Hono } from "hono";
import { TOOL_DEFINITIONS } from "../../agent/tools/index.js";
import { env } from "../../config/env.js";

/**
 * /api/tools - catalog tool cho trang Tools của dashboard. Một nguồn duy nhất
 * từ tool-registry (giống cách reaction-icons làm) - frontend không chép lại.
 * Trạng thái bật/tắt per account nằm trong GET /api/accounts (disabledTools).
 */
export const toolRoutes = new Hono().get("/", (c) =>
  c.json({
    items: TOOL_DEFINITIONS.map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      group: t.group,
    })),
    // Cho UI hiện provider search đang hiệu lực cạnh tool web_search
    webSearchProvider: env.BRAVE_SEARCH_API_KEY ? "Brave + DuckDuckGo" : "DuckDuckGo (miễn phí)",
  }),
);
