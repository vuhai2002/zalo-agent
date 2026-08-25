import type { API, FriendEvent } from "zca-js";
import { createLogger } from "../shared/logger.js";
import { KeHoachKetNoiLai } from "./reconnect-planner.js";

export type RawMessageHandler = (rawMessage: unknown) => Promise<void> | void;
export type FriendEventHandler = (event: FriendEvent) => Promise<void> | void;

/** Trần jitter cộng vào backoff để nhiều account không reconnect đồng loạt */
const JITTER_MS = 1_000;
/** Mã giả cho log khi start() ném (không phải close code thật của zca-js) */
const MA_START_NEM = -1;

/**
 * Start listener cho 1 account, tự reconnect với backoff khi bị đóng.
 * Lưu ý: Zalo chỉ cho 1 web listener/account - mở Zalo Web trên trình duyệt
 * sẽ đá listener này ra (bot sẽ tự reconnect và đá ngược lại phiên web).
 * Trả về hàm stop() để shutdown sạch.
 */
export function startListener(
  accountId: string,
  api: API,
  onMessage: RawMessageHandler,
  onFriendEvent?: FriendEventHandler,
): () => void {
  const log = createLogger(`listener:${accountId}`);
  let stopped = false;
  const keHoach = new KeHoachKetNoiLai();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const lenLichKetNoiLai = (delayMs: number): void => {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      try {
        // ws đã null sau onClosed nên stop() ở đây thường là no-op; gọi phòng khi
        // còn ws sót lại, để start() luôn khởi động từ state sạch.
        api.listener.stop();
        api.listener.start();
      } catch (err) {
        // start() ném = KHÔNG có ws mới = SẼ KHÔNG có onClosed kế tiếp để kích
        // reconnect. Phải TỰ đếm lần hỏng này (leo backoff + có cơ hội chạm ngưỡng
        // nghi phiên chết) rồi lên lịch lại, nếu không vòng reconnect chết câm và
        // bot offline tới lúc restart tay - đúng ca cookie hỏng dai.
        log.error({ err }, "start() ném khi reconnect - đếm là một lần hỏng, tự thử lại");
        xuLyDongVaLenLich(MA_START_NEM, "start() ném khi reconnect");
      }
    }, delayMs);
  };

  // Gộp: tính kế hoạch chờ + log + lên lịch reconnect. Dùng CHUNG cho cả onClosed
  // (đóng bình thường) lẫn nhánh start() ném, để một lần start() hỏng cũng leo
  // backoff và có thể chạm ngưỡng cảnh báo re-login - không đứng yên spam mãi.
  const xuLyDongVaLenLich = (code: number, reason: string): void => {
    const ke = keHoach.danhDauDong(Date.now(), Math.floor(Math.random() * JITTER_MS));
    if (ke.nghiNgoPhienChet) {
      // Nối-rồi-rớt-ngay nhiều lần liên tiếp = dấu hiệu phiên bị thu hồi (đổi mật
      // khẩu, đăng xuất từ xa, hết hạn) HOẶC còn một phiên Zalo Web đang tranh kết
      // nối. Nói THẲNG cách chữa thay vì để người vận hành đoán như ca 2026-08-25.
      log.warn(
        { code, reason, chopTatLienTiep: ke.chopTatLienTiep, delayMs: ke.delayMs },
        `Listener nối rồi rớt ngay ${ke.chopTatLienTiep} lần liên tiếp - phiên Zalo có thể đã hết hạn/bị thu hồi, hoặc còn một phiên Zalo Web đang tranh kết nối. Đóng tab Zalo Web; nếu vẫn lỗi, chạy "pnpm zalo-login ${accountId}" để đăng nhập lại.`,
      );
    } else {
      log.warn(
        { code, reason, delayMs: ke.delayMs, onDinh: ke.onDinh },
        "Listener bị đóng - sẽ kết nối lại",
      );
    }
    lenLichKetNoiLai(ke.delayMs);
  };

  api.listener.on("message", (message) => {
    Promise.resolve(onMessage(message)).catch((err) =>
      log.error({ err }, "Lỗi xử lý tin nhắn"),
    );
  });

  if (onFriendEvent) {
    api.listener.on("friend_event", (event) => {
      Promise.resolve(onFriendEvent(event)).catch((err) =>
        log.error({ err }, "Lỗi xử lý friend_event"),
      );
    });
  }

  api.listener.onConnected(() => {
    keHoach.danhDauKetNoi(Date.now());
    log.info("Listener đã kết nối");
  });

  api.listener.onError((error: unknown) => {
    log.error({ error }, "Listener báo lỗi");
  });

  // code/reason của zca-js (CloseReason: 3000/3003 = bị web session đá hợp lệ,
  // 1006 = rớt bất thường). Chỉ LOG để có số đo; CHƯA cổng ngưỡng nghi-phiên-chết
  // theo mã vì chưa biết Zalo gửi mã nào khi THU HỒI phiên (đổi mật khẩu) - cổng
  // bừa có thể nuốt mất chính cảnh báo cần thiết.
  api.listener.onClosed((code: number, reason: string) => {
    if (stopped) return;
    xuLyDongVaLenLich(code, reason);
  });

  api.listener.start();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      // Đừng để timer reconnect đang chờ (tối đa ~60s) trì hoãn shutdown/toggle.
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      api.listener.stop();
    } catch {
      /* đã đóng sẵn */
    }
  };
}
