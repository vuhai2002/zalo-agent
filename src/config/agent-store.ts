import { db } from "../conversation/database.js";
import type { ReasoningEffort } from "../agent/reasoning-options.js";
import { parseDisabledTools } from "./parse-disabled-tools.js";
import type { LlmProviderKind } from "./llm-provider-kind.js";

/** Não của bot: persona + model override. Gắn vào account qua accounts.agent_id. */
export type AgentProfile = {
  id: string;
  icon: string;
  name: string;
  persona: string;
  /** Override model riêng; null = dùng cấu hình Providers chung */
  modelProvider: LlmProviderKind | null;
  modelName: string | null;
  maxSteps: number | null;
  /** Mức suy nghĩ riêng; null = dùng mức mặc định ở trang Cấu hình */
  reasoningEffort: ReasoningEffort | null;
  /**
   * Tool agent này KHÔNG dùng (danh sách TẮT, rỗng = bật hết).
   *
   * GIAO với `AccountConfig.disabledTools`, không thay thế: tool dùng được là
   * phần không bên nào tắt. Agent khai năng lực, account áp chính sách - xem
   * `listAvailableTools` ở `tool-registry.ts`.
   */
  disabledTools: string[];
  /**
   * Trần token cho phần input mỗi lần gọi model; null = theo LLM_CONTEXT_WINDOW
   * ở trang Cấu hình. Ở đây chứ không chỉ ở cấu hình chung vì trần phụ thuộc
   * cửa sổ của MODEL, mà model đặt được theo từng agent.
   */
  contextWindow: number | null;
  isDefault: boolean;
};

type Row = {
  id: string;
  icon: string;
  name: string;
  persona: string;
  model_provider: string | null;
  model_name: string | null;
  max_steps: number | null;
  reasoning_effort: string | null;
  disabled_tools: string;
  context_window: number | null;
  is_default: number;
};

const toProfile = (r: Row): AgentProfile => ({
  id: r.id,
  icon: r.icon,
  name: r.name,
  persona: r.persona,
  modelProvider: (r.model_provider as AgentProfile["modelProvider"]) ?? null,
  modelName: r.model_name,
  maxSteps: r.max_steps,
  reasoningEffort: (r.reasoning_effort as ReasoningEffort | null) ?? null,
  disabledTools: parseDisabledTools(r.disabled_tools),
  contextWindow: r.context_window,
  isDefault: r.is_default === 1,
});

const SELECT = `SELECT id, icon, name, persona, model_provider, model_name, max_steps, reasoning_effort,
                       disabled_tools, context_window, is_default
                FROM agents`;

const DEFAULT_AGENT_ID = "tro-ly-mac-dinh";

/** Agent mặc định luôn tồn tại - account mới/agent bị xóa đều rơi về đây */
export function ensureDefaultAgent(): AgentProfile {
  const existing = db.prepare(`${SELECT} WHERE is_default = 1 LIMIT 1`).get() as Row | undefined;
  if (existing) return toProfile(existing);

  db.prepare(
    "INSERT OR IGNORE INTO agents (id, icon, name, persona, is_default) VALUES (?, '🤖', ?, '', 1)",
  ).run(DEFAULT_AGENT_ID, "Trợ lý mặc định");
  db.prepare("UPDATE agents SET is_default = 1 WHERE id = ?").run(DEFAULT_AGENT_ID);
  return getAgent(DEFAULT_AGENT_ID)!;
}

export function getAgent(id: string): AgentProfile | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return row ? toProfile(row) : null;
}

/** Agent của account - account trỏ agent đã bị xóa thì rơi về agent mặc định */
export function getAgentForAccount(agentId: string): AgentProfile {
  return getAgent(agentId) ?? ensureDefaultAgent();
}

export function listAgents(): (AgentProfile & { accountCount: number })[] {
  const rows = db
    .prepare(
      `${SELECT.replace("FROM agents", ", (SELECT COUNT(*) FROM accounts WHERE accounts.agent_id = agents.id) AS account_count FROM agents")}
       ORDER BY is_default DESC, id`,
    )
    .all() as unknown as (Row & { account_count: number })[];
  return rows.map((r) => ({ ...toProfile(r), accountCount: r.account_count }));
}

export function createAgent(input: {
  id: string;
  icon?: string;
  name: string;
  persona?: string;
}): AgentProfile {
  db.prepare("INSERT INTO agents (id, icon, name, persona) VALUES (?, ?, ?, ?)").run(
    input.id,
    input.icon ?? "🤖",
    input.name,
    input.persona ?? "",
  );
  return getAgent(input.id)!;
}

export function updateAgent(
  id: string,
  patch: Partial<
    Pick<
      AgentProfile,
      "icon" | "name" | "persona" | "modelProvider" | "modelName" | "maxSteps" | "reasoningEffort" | "disabledTools" | "contextWindow"
    >
  >,
): AgentProfile | null {
  const current = getAgent(id);
  if (!current) return null;
  // Bỏ key có giá trị `undefined` TRƯỚC khi trộn: `Partial<>` cho phép truyền
  // `undefined` tường minh mà vẫn qua được typecheck, và lúc đó `next.x` thành
  // undefined -> node:sqlite ném "Provided value cannot be bound to SQLite
  // parameter". Zod ở biên API đã loại key vắng mặt nên đường route không dính,
  // nhưng call site nội bộ thì không có ai đỡ.
  const patchSach = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as typeof patch;
  const next = { ...current, ...patchSach };
  db.prepare(
    `UPDATE agents SET icon = ?, name = ?, persona = ?, model_provider = ?, model_name = ?, max_steps = ?,
                       reasoning_effort = ?, disabled_tools = ?, context_window = ?
     WHERE id = ?`,
  ).run(
    next.icon,
    next.name,
    next.persona,
    next.modelProvider,
    next.modelName,
    next.maxSteps,
    next.reasoningEffort,
    JSON.stringify(next.disabledTools),
    next.contextWindow,
    id,
  );
  return getAgent(id);
}

/** Không xóa được agent mặc định hoặc agent đang có account dùng */
export function deleteAgent(id: string): { ok: boolean; reason?: string } {
  const agent = getAgent(id);
  if (!agent) return { ok: false, reason: "Agent không tồn tại" };
  if (agent.isDefault) return { ok: false, reason: "Không xóa được agent mặc định" };

  const used = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE agent_id = ?").get(id) as {
    n: number;
  };
  if (used.n > 0) return { ok: false, reason: `Đang có ${used.n} account dùng agent này` };

  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  return { ok: true };
}
