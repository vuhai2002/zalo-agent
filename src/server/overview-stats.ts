import { getEffectiveLlmSettings } from "../config/runtime-llm-settings.js";
import { db } from "../conversation/database.js";

/** Số liệu thật cho trang Overview - không có gì là mock */

const countStmt = (table: string) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`);

const threadsCount = countStmt("threads");
const contactsCount = countStmt("contacts");
const memoriesCount = countStmt("memories");
const messagesCount = countStmt("messages");

// Mốc đầu ngày trước là `strftime('%Y-%m-%dT00:00:00Z','now')` nhúng thẳng
// trong SQL - tức 00:00 UTC = 07:00 sáng giờ VN, lệch cả hai chiều tùy giờ
// xem. Giờ nhận mốc qua THAM SỐ ràng buộc: caller tự tính bằng
// `startOfDayUtc(BOT_TIMEZONE)` (module này thuần, không tự biết timezone).
const messagesTodayStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND created_at >= ?`,
);

export type AccountStats = {
  threads: number;
  contacts: number;
  memories: number;
  messagesTotal: number;
  messagesToday: number;
};

/** `startOfTodayUtc`: mốc UTC ISO của đầu ngày hôm nay theo BOT_TIMEZONE - tính sẵn ở caller (route) rồi truyền xuống. */
export function getAccountStats(accountId: string, startOfTodayUtc: string): AccountStats {
  const n = (stmt: ReturnType<typeof db.prepare>) =>
    (stmt.get(accountId) as { n: number }).n;
  return {
    threads: n(threadsCount),
    contacts: n(contactsCount),
    memories: n(memoriesCount),
    messagesTotal: n(messagesCount),
    messagesToday: (messagesTodayStmt.get(accountId, startOfTodayUtc) as { n: number }).n,
  };
}

export type SystemInfo = {
  uptimeSeconds: number;
  nodeVersion: string;
  llm: {
    provider: string;
    model: string;
    hasOverride: boolean;
    /**
     * Đủ để GỌI ĐƯỢC model chưa (có key + model, và có base URL nếu cần).
     *
     * Cần cờ này vì từ khi `.env` chỉ còn một biến bắt buộc, bot khởi động
     * BÌNH THƯỜNG khi chưa cấu hình gì - dashboard xanh, account online, mà mọi
     * tin nhắn đều nhận câu báo lỗi. Cảnh báo duy nhất trước đây là một dòng
     * `logger.warn` lúc boot, thứ mà người dùng dashboard không bao giờ đọc.
     */
    daCauHinh: boolean;
  };
};

export function getSystemInfo(): SystemInfo {
  const llm = getEffectiveLlmSettings();
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    llm: {
      provider: llm.provider,
      model: llm.model,
      hasOverride: llm.hasOverride,
      daCauHinh: Boolean(
        llm.apiKey && llm.model && (llm.provider !== "openai-compatible" || llm.baseUrl),
      ),
    },
  };
}
