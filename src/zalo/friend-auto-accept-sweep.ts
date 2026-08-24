import type { API } from "zca-js";

import { getAccount } from "../config/account-store.js";
import { layFriendRequestQuaHan, xoaFriendRequest } from "../conversation/friend-request-store.js";
import { createLogger } from "../shared/logger.js";
import { getRunningAccountKenh, getRunningAccounts } from "./account-manager.js";

const log = createLogger("friend-sweep");

/**
 * Chu kỳ quét. Hằng số, KHÔNG chỉnh runtime (YAGNI) - delay per-account mới là
 * thứ người dùng chỉnh. 30s đủ nhanh cho "1-2 phút mới accept" mà không đốt CPU.
 */
const SWEEP_MS = 30_000;

/**
 * Phụ thuộc của một lượt quét. Tách hết ra để `quetMotLuot` là hàm THUẦN test
 * được (không đụng registry account, DB hay mạng thật).
 */
export type QuetDeps = {
  /** Các account đang chạy + api (null với kênh bot / chưa login) */
  dsAccount: () => { id: string; api: API | null }[];
  /** Cấu hình auto-accept HIỆN TẠI (đọc từ DB mỗi lượt -> đổi toggle không cần restart) */
  getConfig: (id: string) => { autoAcceptFriends: boolean; autoAcceptFriendDelayMinutes: number } | null;
  layQuaHan: (accountId: string, truocMoc: number) => { fromUid: string }[];
  xoa: (accountId: string, fromUid: string) => void;
  accept: (api: API, fromUid: string) => Promise<unknown>;
};

/**
 * Một lượt quét: mỗi account cá nhân đang chạy có auto-accept BẬT thì accept mọi
 * request đã chờ quá `delayMinutes` rồi xóa dòng. Một dòng hỏng KHÔNG chặn dòng
 * khác (bọc try/catch từng dòng). Idempotent: dòng đã xóa mà sự kiện ADD tới sau
 * cũng chỉ xóa lại vô hại.
 */
export async function quetMotLuot(now: number, deps: QuetDeps): Promise<void> {
  for (const { id, api } of deps.dsAccount()) {
    if (!api) continue; // kênh bot / chưa chạy - không có gì để accept
    const cfg = deps.getConfig(id);
    if (!cfg || !cfg.autoAcceptFriends) continue;

    const moc = now - cfg.autoAcceptFriendDelayMinutes * 60_000;
    for (const row of deps.layQuaHan(id, moc)) {
      try {
        await deps.accept(api, row.fromUid);
        deps.xoa(id, row.fromUid);
        log.info({ id, fromUid: row.fromUid }, "auto-accept yêu cầu kết bạn");
      } catch (err) {
        log.warn({ err, id, fromUid: row.fromUid }, "auto-accept 1 dòng hỏng - bỏ qua dòng này");
      }
    }
  }
}

const depThat: QuetDeps = {
  dsAccount: () =>
    getRunningAccounts().map((a) => ({ id: a.id, api: getRunningAccountKenh(a.id)?.api ?? null })),
  getConfig: (id) => {
    const a = getAccount(id);
    return a
      ? {
          autoAcceptFriends: a.autoAcceptFriends,
          autoAcceptFriendDelayMinutes: a.autoAcceptFriendDelayMinutes,
        }
      : null;
  },
  layQuaHan: layFriendRequestQuaHan,
  xoa: xoaFriendRequest,
  accept: (api, fromUid) => api.acceptFriendRequest(fromUid),
};

/** Khởi động vòng quét (1 timer toàn cục). Trả hàm dừng cho shutdown. */
export function startFriendAutoAcceptSweep(): () => void {
  const timer = setInterval(() => {
    quetMotLuot(Date.now(), depThat).catch((err) =>
      log.error({ err }, "vòng quét auto-accept lỗi"),
    );
  }, SWEEP_MS);
  timer.unref();
  return () => clearInterval(timer);
}
