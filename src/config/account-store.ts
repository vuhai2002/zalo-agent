import { db } from "../conversation/database.js";
import { createLogger } from "../shared/logger.js";
import { trongGiaoDich } from "../shared/db-transaction.js";
import { decryptSecret, encryptSecret } from "./secret-cipher.js";
import { createAgent, ensureDefaultAgent, getAgent } from "./agent-store.js";
import { readAccountsSeedFile } from "./accounts.js";
import { parseDisabledTools } from "./parse-disabled-tools.js";

const log = createLogger("account-store");

/**
 * Loại KÊNH của một tài khoản.
 *
 * - `ca_nhan`: đăng nhập nick Zalo thật qua zca-js (giao thức đảo ngược). Đủ
 *   năng lực nhất nhưng CÓ rủi ro bị Zalo khóa tài khoản.
 * - `bot`: tài khoản bot chính thức qua Zalo Bot API. Không có rủi ro khóa,
 *   đổi lại 7 trong 14 tool không chạy được - xem `nang-luc-kenh-bot.ts`.
 */
export type LoaiKenh = "ca_nhan" | "bot";

/** Tài khoản Zalo (kênh). Não nằm ở agent, trỏ qua agentId. */
export type AccountConfig = {
  id: string;
  label: string;
  loai: LoaiKenh;
  /**
   * Đã có token bot chưa. CỐ Ý không mang chính token: object này đi thẳng ra
   * `GET /api/accounts` nên để token ở đây là lộ bí mật cho mọi phiên dashboard.
   * Code cần token thật thì gọi `layBotTokenGiaiMa()` - một đường riêng, dễ soi.
   */
  coBotToken: boolean;
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
  loai: string;
  bot_token_enc: string;
};

const toConfig = (r: Row): AccountConfig => ({
  id: r.id,
  label: r.label,
  // Giá trị lạ trong cột (sửa tay DB, hoặc bản cũ hơn) rơi về "ca_nhan" thay vì
  // ép kiểu bừa: đó là loại duy nhất tồn tại trước khi có cột này.
  loai: r.loai === "bot" ? "bot" : "ca_nhan",
  coBotToken: r.bot_token_enc !== "",
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
                       disabled_tools, loai, bot_token_enc
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
  /**
   * KHÔNG nhận `loai` và `coBotToken`: câu UPDATE dưới đây không có hai cột đó,
   * nên nhận vào là nuốt lặng lẽ rồi trả về giá trị CŨ như thể đã lưu. Thu hẹp
   * kiểu để trình biên dịch chặn thay vì để người gọi phát hiện bằng cách thấy
   * dashboard không đổi gì. Đổi loại kênh đi qua `datLoaiKenh()`, đổi token đi
   * qua `datBotToken()`.
   */
  patch: Partial<Omit<AccountConfig, "id" | "loai" | "coBotToken">>,
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
  return trongGiaoDich(db, () => {
    // Dọn luôn lịch hẹn của account. Không có khóa ngoại cascade, nên thiếu
    // bước này thì job trở thành MỒ CÔI và sống dậy nếu ai đó tạo lại một
    // account CÙNG ID - kể cả với loại kênh khác. Đó cũng là kẽ hở duy nhất
    // của bất biến "`loai` chốt lúc tạo": ba lớp chặn đều canh tầng UPDATE,
    // không tầng xóa-rồi-tạo-lại.
    db.prepare("DELETE FROM scheduled_jobs WHERE account_id = ?").run(id);
    return db.prepare("DELETE FROM accounts WHERE id = ?").run(id).changes > 0;
  });
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

/**
 * Token bot ĐÃ GIẢI MÃ. Đường riêng, KHÔNG đi qua `AccountConfig` - object đó
 * được trả nguyên vẹn ở `GET /api/accounts`, nên token nằm trong đó là lộ bí
 * mật cho mọi phiên dashboard đang mở. Tách ra thành một hàm để chỗ nào đọc
 * token thật đều grep ra được ngay.
 *
 * Trả `null` khi: chưa nhập token, hoặc giải mã hỏng. (Câu SQL KHÔNG lọc `loai` -
 * không cần, vì không đường nào đặt `bot_token_enc` cho tài khoản cá nhân:
 * `PUT /bot-token` chặn ở route.)
 * Hai ca này caller đều xử lý như nhau (không chạy được kênh đó), nhưng ca giải
 * mã hỏng có LOG riêng vì nó nghĩa là `CREDENTIALS_ENCRYPTION_KEY` đã đổi so
 * với lúc lưu - im lặng rơi về null ở đây thì người vận hành đi tìm nhầm chỗ.
 */
export function layBotTokenGiaiMa(id: string): string | null {
  const row = db.prepare("SELECT bot_token_enc FROM accounts WHERE id = ?").get(id) as
    | { bot_token_enc: string }
    | undefined;
  if (!row?.bot_token_enc) return null;
  try {
    return decryptSecret(row.bot_token_enc);
  } catch (err) {
    log.error(
      { err, accountId: id },
      "Không giải mã được token bot - CREDENTIALS_ENCRYPTION_KEY có đúng khóa lúc lưu không?",
    );
    return null;
  }
}

/** Lưu token bot (mã hóa). Chuỗi rỗng = xóa token. */
export function datBotToken(id: string, token: string): void {
  const enc = token.trim() ? encryptSecret(token.trim()) : "";
  db.prepare("UPDATE accounts SET bot_token_enc = ? WHERE id = ?").run(enc, id);
}

/**
 * Đổi loại kênh của tài khoản. Đường riêng vì `updateAccount` cố ý không nhận
 * `loai` - xem docstring ở đó.
 */
export function datLoaiKenh(id: string, loai: LoaiKenh): void {
  db.prepare("UPDATE accounts SET loai = ? WHERE id = ?").run(loai, id);
}
