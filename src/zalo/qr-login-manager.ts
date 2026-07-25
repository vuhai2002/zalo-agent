import type { API } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { createLogger } from "../shared/logger.js";
import { attachAccount, stopAccount } from "./account-manager.js";
import { loginWithQRForWeb, type QrLoginEvent } from "./zalo-client.js";

const log = createLogger("qr-login-manager");

/**
 * Quản lý phiên login QR từ dashboard: mỗi account tối đa 1 phiên, UI polling
 * trạng thái. QR là chìa khóa đăng nhập tài khoản - KHÔNG log base64, chỉ đi
 * qua API đã auth.
 */

export type QrLoginStatus =
  | "starting"
  | "waiting_scan"
  | "scanned"
  | "success"
  | "declined"
  | "error";

type QrSession = {
  seq: number;
  status: QrLoginStatus;
  qrBase64?: string;
  error?: string;
  startedAt: number;
};

const SESSION_TTL_MS = 3 * 60_000;

const sessions = new Map<string, QrSession>();
let seqCounter = 0;

/** Cho test inject login/attach giả - mặc định dùng zca-js thật */
export type QrLoginDeps = {
  login: (accountId: string, onEvent: (e: QrLoginEvent) => void) => Promise<API>;
  attach: (accountId: string, api: API) => void;
};

const defaultDeps: QrLoginDeps = {
  login: loginWithQRForWeb,
  attach: (accountId, api) => {
    const config = getAccount(accountId);
    // Account đã bị xóa trong lúc chờ quét thì thôi - credentials vẫn được lưu
    if (config?.enabled) attachAccount(config, api);
  },
};

export function startQrLogin(accountId: string, deps: QrLoginDeps = defaultDeps): QrSession {
  const existing = sessions.get(accountId);
  const active =
    existing &&
    ["starting", "waiting_scan", "scanned"].includes(existing.status) &&
    Date.now() - existing.startedAt < SESSION_TTL_MS;
  if (active) return existing;

  // Re-login account đang chạy: đá listener cũ trước (Zalo chỉ cho 1 listener)
  stopAccount(accountId);

  const seq = ++seqCounter;
  const session: QrSession = { seq, status: "starting", startedAt: Date.now() };
  sessions.set(accountId, session);

  // Phiên mới đè phiên cũ: mọi update từ promise cũ bị bỏ qua nhờ check seq
  const stillCurrent = () => sessions.get(accountId)?.seq === seq;

  deps
    .login(accountId, (event) => {
      if (!stillCurrent()) return;
      if (event.type === "qr") {
        session.status = "waiting_scan";
        session.qrBase64 = event.qrBase64;
      } else if (event.type === "scanned") {
        session.status = "scanned";
      } else if (event.type === "declined") {
        session.status = "declined";
      }
      // "expired": zca-js tự tạo QR mới rồi bắn lại event "qr" - không cần xử lý
    })
    .then((api) => {
      if (!stillCurrent()) return;
      session.status = "success";
      session.qrBase64 = undefined;
      deps.attach(accountId, api);
      log.info({ accountId }, "Login QR từ dashboard thành công");
    })
    .catch((err) => {
      if (!stillCurrent()) return;
      session.status = "error";
      session.error = err instanceof Error ? err.message : String(err);
      log.warn({ accountId, err: session.error }, "Login QR thất bại");
    });

  return session;
}

export function getQrLoginStatus(
  accountId: string,
): { status: QrLoginStatus | "idle" | "timeout"; qrDataUri?: string; error?: string } {
  const session = sessions.get(accountId);
  if (!session) return { status: "idle" };

  const pending = ["starting", "waiting_scan", "scanned"].includes(session.status);
  if (pending && Date.now() - session.startedAt >= SESSION_TTL_MS) {
    // Quá 3 phút không quét: coi như hết phiên, promise về sau bị bỏ qua theo seq
    sessions.delete(accountId);
    return { status: "timeout" };
  }

  return {
    status: session.status,
    qrDataUri: session.qrBase64 ? `data:image/png;base64,${session.qrBase64}` : undefined,
    error: session.error,
  };
}
