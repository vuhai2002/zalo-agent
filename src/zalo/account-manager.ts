import type { API } from "zca-js";
import { chayTaiKhoanBot } from "../zalo-bot/bot-account-runner.js";
import {
  getAccount,
  layBotTokenGiaiMa,
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
  /**
   * `null` với tài khoản BOT: Zalo Bot API không có gì tương đương. Scheduler
   * đọc trường này qua `getRunningAccountApi` và tự bỏ lượt khi không có -
   * xem mục "Việc còn treo của kênh Zalo Bot" trong roadmap.
   */
  api: API | null;
  /** Rỗng với tài khoản bot - Bot API không có khái niệm "id của chính mình" trong tin */
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
  return running.get(accountId)?.api ?? undefined;
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

  if (config.loai === "bot") {
    await startBotAccount(config);
    return;
  }

  const api = await loginWithStoredCredentials(accountId);
  attachAccount(config, api);
}

/**
 * Tài khoản BOT: không login QR, không credential mã hóa - chỉ một token.
 *
 * Tách hẳn khỏi đường cá nhân thay vì thêm nhánh `if` vào `attachAccount`: hai
 * đường không dùng chung bước nào (không QR, không `getOwnId`, listener khác
 * hẳn), nên gộp chỉ tạo một hàm hai mặt.
 */
async function startBotAccount(config: AccountConfig): Promise<void> {
  const token = layBotTokenGiaiMa(config.id);
  if (!token) {
    throw new Error(
      `Tài khoản bot "${config.id}" chưa có token (hoặc giải mã hỏng) - nhập token ở trang Accounts`,
    );
  }

  const { dung } = await chayTaiKhoanBot({ accountId: config.id, token });
  // `stopAccount` phải nằm SAU await, ngay trước `running.set` - đúng chỗ
  // `attachAccount` đặt nó cho kênh cá nhân. Đặt trước await thì hai lời gọi
  // `startAccount` chồng nhau (bấm hai lần trên dashboard, hoặc dashboard chen
  // vào lúc boot) đều thấy `isAccountRunning === false`, cùng mở vòng poll, rồi
  // `running.set` thứ hai đè lên `dung` thứ nhất mà không gọi nó. Vòng mồ côi
  // đó sống tới lúc restart, và vì `getUpdates` không có `offset` nên nó CƯỚP
  // tin của vòng chính rồi trả lời bằng config cũ.
  stopAccount(config.id);
  running.set(config.id, { config, api: null, selfId: "", stopListener: dung });
  log.info({ accountId: config.id, label: config.label }, "Tài khoản bot sẵn sàng");
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
