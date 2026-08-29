import { Hono } from "hono";
import { listAgents } from "../../config/agent-store.js";
import {
  agentCuaServer,
  datAgentChoServer,
  datServerChoAgent,
  demAgentTheoServer,
  serversCuaAgent,
} from "../../mcp/mcp-agent-binding.js";
import { ketNoiLaiServer, ngatServer, duyetLaiDrift, trangThaiCacServer } from "../../mcp/mcp-manager.js";
import { capNhatServer, danhSachServer, taoServer, xoaHeaders, xoaServer } from "../../mcp/mcp-server-store.js";
import { ganAgentSchema, ganServerSchema, suaServerSchema, taoServerSchema } from "./mcp-route-guards.js";

/**
 * /api/mcp - CRUD server MCP ngoài + gán agent + trạng thái kết nối.
 *
 * Store/binding là hàm module-level, import THẲNG (như `kb-routes.ts` import
 * `kb-source-store.ts`) - chỉ `manager` (state runtime: kết nối đang mở) mới
 * TIÊM qua `deps`, để test không phải nối mạng thật.
 */
export type McpRoutesDeps = {
  manager: {
    ketNoiLaiServer: (id: string) => Promise<void>;
    ngatServer: (id: string) => Promise<void>;
    duyetLaiDrift: (id: string) => Promise<void>;
    trangThaiCacServer: () => { serverId: string; trangThai: string; soTool: number; loi: string }[];
  };
};

export function createMcpRoutes(deps: McpRoutesDeps) {
  return new Hono()
    .get("/", (c) => {
      const dem = demAgentTheoServer();
      const tt = new Map(deps.manager.trangThaiCacServer().map((x) => [x.serverId, x]));
      const servers = danhSachServer().map((s) => ({
        ...s,
        soAgentGan: dem.get(s.id) ?? 0,
        runtime: tt.get(s.id) ?? null,
      }));
      return c.json({ servers });
    })
    .post("/", async (c) => {
      const p = taoServerSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      const svr = taoServer(p.data);
      void deps.manager.ketNoiLaiServer(svr.id); // nối nền, không chặn response
      return c.json({ server: svr }, 201);
    })
    .patch("/:id", async (c) => {
      const p = suaServerSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      capNhatServer(c.req.param("id"), p.data);
      void deps.manager.ketNoiLaiServer(c.req.param("id")); // đổi url/headers/enabled -> nối nền lại
      return c.json({ ok: true });
    })
    .delete("/:id", async (c) => {
      // await: phải chắc client đã đóng trước khi xóa dòng DB - xóa trước thì
      // manager mất đường tra `layServerNoiBo` cho phần dọn dở dang.
      await deps.manager.ngatServer(c.req.param("id"));
      xoaServer(c.req.param("id")); // trongGiaoDich: dọn luôn agent_mcp_servers
      return c.json({ ok: true });
    })
    .delete("/:id/headers", (c) => {
      xoaHeaders(c.req.param("id"));
      return c.json({ ok: true });
    })
    .post("/:id/duyet-lai", async (c) => {
      await deps.manager.duyetLaiDrift(c.req.param("id"));
      return c.json({ ok: true });
    })
    .get("/agents", (c) => c.json({ agents: listAgents().map((a) => ({ id: a.id, name: a.name, icon: a.icon })) }))
    .get("/:id/agents", (c) => c.json({ agentIds: agentCuaServer(c.req.param("id")) }))
    .put("/:id/agents", async (c) => {
      const p = ganAgentSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      datAgentChoServer(c.req.param("id"), p.data.agentIds);
      return c.json({ ok: true });
    })
    .get("/agents/:agentId/servers", (c) => c.json({ serverIds: serversCuaAgent(c.req.param("agentId")) }))
    .put("/agents/:agentId/servers", async (c) => {
      const p = ganServerSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      datServerChoAgent(c.req.param("agentId"), p.data.serverIds);
      return c.json({ ok: true });
    });
}

export const mcpRoutes = createMcpRoutes({
  manager: { ketNoiLaiServer, ngatServer, duyetLaiDrift, trangThaiCacServer },
});
