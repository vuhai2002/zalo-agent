import type { API } from "zca-js";
import {
  getAccount,
  listEnabledAccounts,
  runAccountsSeedMigration,
  type AccountConfig,
} from "../config/account-store.js";
import { runStartupBackfill } from "../conversation/startup-backfill.js";
import { clearPendingBatches } from "../middleware/message-batcher.js";
import { createLogger } from "../shared/logger.js";
import { routeIncomingMessage } from "./incoming-message-router.js";
import { loginWithStoredCredentials } from "./zalo-client.js";
import { startListener } from "./zalo-listener.js";

/**
 * Vòng đời của các account đang chạy. Đường đi của tin nhắn nằm ở
 * `incoming-message-router.ts` (lọc + ghi) và `message-turn-processor.ts`
 * (lượt agent + trả lời).
 */

type RunningAccount = {
  config: AccountConfig;
  api: API;
  selfId: string;
  stopListener: () => void;
};

const running = new Map<string, RunningAccount>();
const log = createLogger("account-manager");

/** Trạng thái account đang chạy - cho dashboard */
export function getRunningAccounts(): { id: string; label: string; selfId: string }[] {
  return [...running.values()].map((a) => ({
    id: a.config.id,
    label: a.config.label,
    selfId: a.selfId,
  }));
}

export function isAccountRunning(accountId: string): boolean {
  return running.has(accountId);
}

/**
 * `api` của account đang chạy - scheduler cần để gọi zca-js đúng account khi
 * gửi tin chủ động (không có tin đến để mà lấy `api` như đường tin nhắn
 * thường). `undefined` khi account chưa login hoặc đã dừng - caller (guard
 * lúc gửi) tự quyết định bỏ lượt.
 */
export function getRunningAccountApi(accountId: string): API | undefined {
  return running.get(accountId)?.api;
}

/**
 * Gắn 1 account đã có API instance vào hệ thống (login QR web xong gọi thẳng
 * vào đây để không phải login lần 2). Account đang chạy thì thay thế.
 */
export function attachAccount(config: AccountConfig, api: API): void {
  stopAccount(config.id);
  const selfId = String(api.getOwnId());
  const stopListener = startListener(config.id, api, (raw) =>
    routeIncomingMessage(config.id, api, selfId, raw),
  );
  running.set(config.id, { config, api, selfId, stopListener });
  log.info({ accountId: config.id, label: config.label }, "Account sẵn sàng");
}

/** Start bằng credentials đã lưu - dùng lúc boot và khi bật lại từ dashboard */
export async function startAccount(accountId: string): Promise<void> {
  const config = getAccount(accountId);
  if (!config) throw new Error(`Account "${accountId}" không tồn tại`);
  if (!config.enabled) throw new Error(`Account "${accountId}" đang tắt`);

  const api = await loginWithStoredCredentials(accountId);
  attachAccount(config, api);
}

export function stopAccount(accountId: string): void {
  const account = running.get(accountId);
  if (!account) return;
  account.stopListener();
  running.delete(accountId);
  log.info({ accountId }, "Đã dừng listener");
}

export async function startAllAccounts(): Promise<void> {
  runStartupBackfill();
  runAccountsSeedMigration();

  const accounts = listEnabledAccounts();
  for (const config of accounts) {
    try {
      await startAccount(config.id);
    } catch (err) {
      log.error({ accountId: config.id, err }, "Không khởi động được account - bỏ qua");
    }
  }

  // Không account nào chạy vẫn KHÔNG chết: dashboard cần sống để user thêm
  // account + quét QR ngay trên web (khác bản cũ vốn throw ở đây)
  log.info(
    { total: running.size, configured: accounts.length },
    running.size > 0 ? "Account đã khởi động" : "Chưa account nào chạy - thêm/login qua dashboard",
  );
}

export function stopAllAccounts(): void {
  clearPendingBatches();
  for (const id of [...running.keys()]) {
    stopAccount(id);
  }
  log.info("Đã dừng toàn bộ listener");
}
