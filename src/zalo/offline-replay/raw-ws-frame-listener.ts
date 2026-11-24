import type { API } from "zca-js";

/**
 * Nghe thẳng khung WebSocket của listener zca-js cho lệnh mà thư viện bỏ bớt
 * dữ liệu (phản hồi lấy bù 510/511: zca-js vứt `more` / `lastActionId`). Khung
 * Zalo: byte 0 phiên bản, byte 1-2 số lệnh (little-endian), byte 3 lệnh con,
 * rồi JSON. Chỉ soi đầu khung, đúng lệnh mới gọi `onFrame` - tin thường không
 * tốn công giải mã. Listener tạo WebSocket MỚI mỗi lần nối lại nên gắn lại sau
 * mỗi "connected". Cách làm theo `zalo-archive-mcp/src/zalo/raw-ws-frame-listener.ts`.
 */
type WsLike = {
  on: (e: string, fn: (d: unknown, isBinary?: unknown) => void) => void;
  off?: (e: string, fn: (d: unknown, isBinary?: unknown) => void) => void;
};
type ListenerLike = {
  on: (event: string, fn: () => void) => void;
  off?: (event: string, fn: () => void) => void;
  ws?: WsLike | null;
  cipherKey?: string | null;
};

export function ganNgheKhungWsTho(
  api: API,
  lenh: { cmd: number; subCmd: number },
  onFrame: (frame: Buffer, cipherKey: string | null) => void,
  onError: (err: unknown) => void,
): () => void {
  const listener = (api as unknown as { listener?: ListenerLike }).listener;
  if (!listener || typeof listener.on !== "function") return () => {};
  let wsDangGan: WsLike | null = null;

  const xuLy = (data: unknown, isBinary?: unknown): void => {
    // Khung chữ: thư viện ws vẫn đưa Buffer cho `on("message")`, còn `onmessage`
    // của zca-js nhận chuỗi nên bỏ qua - bỏ theo
    if (isBinary === false) return;
    if (!Buffer.isBuffer(data) || data.length < 5 || data[0] !== 1) return;
    if (data.readUInt16LE(1) !== lenh.cmd || data[3] !== lenh.subCmd) return;
    try {
      onFrame(data, listener.cipherKey ?? null);
    } catch (err) {
      // Ném ra đây là đi vào receiver của ws -> uncaughtException -> thoát tiến
      // trình, kéo theo mọi account. onError hỏng cũng phải nuốt.
      try {
        onError(err);
      } catch {
        /* nuốt */
      }
    }
  };

  const gan = (): void => {
    const ws = listener.ws ?? null;
    if (!ws || ws === wsDangGan) return;
    wsDangGan?.off?.("message", xuLy);
    wsDangGan = ws;
    ws.on("message", xuLy);
  };

  listener.on("connected", gan);
  gan();
  return () => {
    listener.off?.("connected", gan);
    wsDangGan?.off?.("message", xuLy);
    wsDangGan = null;
  };
}
