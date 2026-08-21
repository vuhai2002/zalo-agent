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
import { kenhCaNhan } from "./kenh-ca-nhan.js";
import type { KenhLuot } from "./kenh-luot.js";
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
   * NĂNG LỰC của kênh account này đang chạy - đường gửi, trần ký tự một tin,
   * và `api` zca-js (`null` trên kênh bot).
   *
   * Trước đây chỗ này giữ thẳng `api: API | null`, tức sổ đăng ký account chỉ
   * mô tả được ĐÚNG MỘT kênh. Hệ quả: caller nào chỉ cầm `accountId` (đường
   * gửi chủ động của scheduler) không có cách nào gửi cho tài khoản bot, dù
   * `kenhBot.duongGui` vẫn chạy tốt mỗi ngày ở luồng tin nhắn. `api` giờ là
   * một TRƯỜNG CON của `kenh`, không còn bản sao thứ hai để lệch.
   */
  kenh: KenhLuot;
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
 * KHÔNG có `getRunningAccountApi` nữa - cố ý.
 *
 * Hàm đó trả `api` zca-js theo `accountId`, và mọi caller của nó đều đi tiếp
 * một bước giống hệt nhau: tự dựng `duongGuiZcaJs`. Tức nó là một cái bẫy có
 * hình dạng tiện lợi - dùng đúng như tên gọi gợi ý là khóa cứng caller vào
 * kênh cá nhân, và đó chính là lỗi khiến lịch hẹn không chạy được trên tài
 * khoản bot suốt từ V3.16 (xem V3.19 trong roadmap). Sau khi scheduler chuyển
 * sang `getRunningAccountKenh`, hàm cũ không còn caller sản xuất nào; xóa hẳn
 * thay vì để lại, vì để lại là mời người sau đi đúng vào vết đó.
 *
 * Cần `api` cho tool thì lấy qua `getRunningAccountKenh(id)?.api` - đường đó
 * bắt người đọc thấy ngay rằng `null` là một khả năng thật.
 */

/**
 * Kênh của account đang chạy - đường DUY NHẤT để một caller chỉ cầm
 * `accountId` gửi được tin mà không cần biết account đó thuộc kênh nào.
 *
 * `undefined` khi account chưa chạy (chưa login, đang tắt, đã dừng) - caller
 * tự quyết định bỏ lượt. Với scheduler, "không có kênh" và "account không
 * chạy" là CÙNG một trạng thái, nên nó dùng chung đúng một nhánh
 * `concludeBlockedNotRun` cho cả hai kênh.
 */
export function getRunningAccountKenh(accountId: string): KenhLuot | undefined {
  return running.get(accountId)?.kenh;
}

/**
 * Gắn 1 account đã có API instance vào hệ thống (login QR web xong gọi thẳng
 * vào đây để không phải login lần 2). Account đang chạy thì thay thế.
 */
export function attachAccount(config: AccountConfig, api: API): void {
  // Lá chắn cuối: `attachAccount` gắn api ZCA-JS, chỉ đúng với kênh cá nhân.
  // Gắn cho tài khoản bot là giết vòng poll rồi để lại một tài khoản nửa nọ
  // nửa kia (gửi được file, nhưng toolset và persona vẫn theo `loai: "bot"`).
  // Route login đã chặn, nhưng `qr-login-manager` gọi thẳng vào đây nên phải
  // có chốt ở chính hàm này.
  if (config.loai === "bot") {
    throw new Error(`Account "${config.id}" là tài khoản bot - không gắn được API zca-js`);
  }
  stopAccount(config.id);
  const selfId = String(api.getOwnId());
  const stopListener = startListener(config.id, api, (raw) =>
    routeIncomingMessage(config.id, api, selfId, raw),
  );
  running.set(config.id, { config, kenh: kenhCaNhan(api), selfId, stopListener });
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

  const { dung, kenh } = await chayTaiKhoanBot({ accountId: config.id, token });

  // Đọc LẠI `enabled` ngay trước khi cài vào `running`: `chayTaiKhoanBot` mất
  // hai vòng mạng (hạn 15 giây mỗi cái), đủ rộng để người vận hành bấm TẮT
  // trong lúc chờ. Lúc đó `stopAccount` của route là no-op (chưa có gì trong
  // `running`), rồi dòng dưới cài vòng poll vào một account mà DB nói là tắt -
  // công tắc an toàn hỏng CÂM, bot vẫn đọc tin người lạ và đốt token.
  if (!getAccount(config.id)?.enabled) {
    dung();
    log.info({ accountId: config.id }, "Account bị tắt trong lúc đang khởi động - đã dừng vòng poll");
    return;
  }
  // `stopAccount` phải nằm SAU await, ngay trước `running.set` - đúng chỗ
  // `attachAccount` đặt nó cho kênh cá nhân. Đặt trước await thì hai lời gọi
  // `startAccount` chồng nhau (bấm hai lần trên dashboard, hoặc dashboard chen
  // vào lúc boot) đều thấy `isAccountRunning === false`, cùng mở vòng poll, rồi
  // `running.set` thứ hai đè lên `dung` thứ nhất mà không gọi nó. Vòng mồ côi
  // đó sống tới lúc restart, và vì `getUpdates` không có `offset` nên nó CƯỚP
  // tin của vòng chính rồi trả lời bằng config cũ.
  stopAccount(config.id);
  running.set(config.id, { config, kenh, selfId: "", stopListener: dung });
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
