import { db } from "../conversation/database.js";
import { createLogger } from "../shared/logger.js";
import { createAgent, ensureDefaultAgent, getAgent } from "./agent-store.js";
import { readAccountsSeedFile } from "./accounts.js";
import { parseDisabledTools } from "./parse-disabled-tools.js";

const log = createLogger("account-store");

/** Tài khoản Zalo (kênh). Não nằm ở agent, trỏ qua agentId. */
export type AccountConfig = {
  id: string;
  label: string;
  enabled: boolean;
  agentId: string;
  allowlist: { mode: "all" | "list"; userIds: string[] };
  groupRequireMention: boolean;
  respondToGroups: boolean;
  groupPassiveListen: boolean;
  /** Thả reaction ngay khi nhận tin để người nhắn biết bot đã thấy */
  autoReactEnabled: boolean;
  /** Key trong REACTION_ICONS (zalo/reaction-icons.ts) */
  autoReactIcon: string;
  /** Báo "đang nhập" trong lúc agent xử lý */
  typingIndicatorEnabled: boolean;
  /**
   * Key các tool bị tắt trên trang Tools (danh sách trắng ngược: mặc định
   * mọi tool bật, tắt cái nào ghi cái đó - tool MỚI thêm vào registry tự bật
   * cho account cũ, không cần migration).
   */
  disabledTools: string[];
};

type Row = {
  id: string;
  label: string;
  enabled: number;
  agent_id: string;
  allowlist_mode: "all" | "list";
  allowlist_user_ids: string;
  group_require_mention: number;
  respond_to_groups: number;
  group_passive_listen: number;
  auto_react_enabled: number;
  auto_react_icon: string;
  typing_indicator_enabled: number;
  disabled_tools: string;
};

const toConfig = (r: Row): AccountConfig => ({
  id: r.id,
  label: r.label,
  enabled: r.enabled === 1,
  agentId: r.agent_id,
  allowlist: { mode: r.allowlist_mode, userIds: JSON.parse(r.allowlist_user_ids) as string[] },
  groupRequireMention: r.group_require_mention === 1,
  respondToGroups: r.respond_to_groups === 1,
  groupPassiveListen: r.group_passive_listen === 1,
  autoReactEnabled: r.auto_react_enabled === 1,
  autoReactIcon: r.auto_react_icon,
  typingIndicatorEnabled: r.typing_indicator_enabled === 1,
  disabledTools: parseDisabledTools(r.disabled_tools),
});

const SELECT = `SELECT id, label, enabled, agent_id, allowlist_mode, allowlist_user_ids,
                       group_require_mention, respond_to_groups, group_passive_listen,
                       auto_react_enabled, auto_react_icon, typing_indicator_enabled,
                       disabled_tools
                FROM accounts`;

export function listAccounts(): AccountConfig[] {
  return (db.prepare(`${SELECT} ORDER BY id`).all() as unknown as Row[]).map(toConfig);
}

export function listEnabledAccounts(): AccountConfig[] {
  return listAccounts().filter((a) => a.enabled);
}

export function getAccount(id: string): AccountConfig | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return row ? toConfig(row) : null;
}

export function createAccount(input: { id: string; label: string; agentId?: string }): AccountConfig {
  const agentId = input.agentId && getAgent(input.agentId) ? input.agentId : ensureDefaultAgent().id;
  db.prepare("INSERT INTO accounts (id, label, agent_id) VALUES (?, ?, ?)").run(
    input.id,
    input.label,
    agentId,
  );
  return getAccount(input.id)!;
}

export function updateAccount(
  id: string,
  patch: Partial<Omit<AccountConfig, "id">>,
): AccountConfig | null {
  const current = getAccount(id);
  if (!current) return null;
  const next = { ...current, ...patch, allowlist: patch.allowlist ?? current.allowlist };
  db.prepare(
    `UPDATE accounts SET label = ?, enabled = ?, agent_id = ?, allowlist_mode = ?,
       allowlist_user_ids = ?, group_require_mention = ?, respond_to_groups = ?,
       group_passive_listen = ?, auto_react_enabled = ?, auto_react_icon = ?,
       typing_indicator_enabled = ?, disabled_tools = ?
     WHERE id = ?`,
  ).run(
    next.label,
    next.enabled ? 1 : 0,
    next.agentId,
    next.allowlist.mode,
    JSON.stringify(next.allowlist.userIds),
    next.groupRequireMention ? 1 : 0,
    next.respondToGroups ? 1 : 0,
    next.groupPassiveListen ? 1 : 0,
    next.autoReactEnabled ? 1 : 0,
    next.autoReactIcon,
    next.typingIndicatorEnabled ? 1 : 0,
    JSON.stringify(next.disabledTools),
    id,
  );
  return getAccount(id);
}

export function deleteAccount(id: string): boolean {
  return db.prepare("DELETE FROM accounts WHERE id = ?").run(id).changes > 0;
}

/**
 * Seed 1 lần từ config/accounts.json (bản cũ trước khi DB là source of truth).
 * Account có persona riêng được tách thành agent riêng để giữ nguyên hành vi;
 * persona rỗng dùng agent mặc định. Bảng accounts đã có dữ liệu thì bỏ qua.
 */
export function runAccountsSeedMigration(configPath?: string): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
  if (count > 0) {
    ensureDefaultAgent();
    return;
  }

  const defaultAgent = ensureDefaultAgent();
  const seed = readAccountsSeedFile(configPath);
  if (!seed) return;

  for (const acc of seed) {
    let agentId = defaultAgent.id;
    if (acc.persona.trim()) {
      const created = createAgent({
        id: `${acc.id}-agent`,
        name: `Não của ${acc.label}`,
        persona: acc.persona.trim(),
      });
      agentId = created.id;
    }
    db.prepare(
      `INSERT INTO accounts (id, label, enabled, agent_id, allowlist_mode, allowlist_user_ids,
         group_require_mention, respond_to_groups, group_passive_listen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      acc.id,
      acc.label,
      acc.enabled ? 1 : 0,
      agentId,
      acc.allowlist.mode,
      JSON.stringify(acc.allowlist.userIds),
      acc.groupRequireMention ? 1 : 0,
      acc.respondToGroups ? 1 : 0,
      acc.groupPassiveListen ? 1 : 0,
    );
  }
  log.info({ imported: seed.length }, "Đã import accounts.json vào DB (chỉ chạy 1 lần)");
}
