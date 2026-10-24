import { createMCPClient } from "@ai-sdk/mcp";
import type { Tool } from "ai";

/**
 * Nối tới MỘT MCP server ngoài qua Streamable HTTP, có trần thời gian.
 *
 * Server ngoài không do mình vận hành nên có thể treo vô thời hạn lúc bắt tay
 * (`initialize`) - không có trần thì `mcp-manager.ts` sẽ đứng chờ mãi mãi cho
 * MỘT server hỏng, kéo theo boot/health không bao giờ xong. `redirect` của
 * `@ai-sdk/mcp` mặc định `'error'` (không tự follow redirect) - giữ nguyên,
 * chống SSRF-qua-redirect mà không cần viết thêm gì.
 */

export type KetNoiMcp = { tools(): Promise<Record<string, Tool>>; close(): Promise<void> };

/** Lỗi có KIỂU (không phải chuỗi thô) để caller phân biệt được với lỗi khác. */
export type LoiKetNoiMcp = Error & { loaiLoi: "ket_noi" };

function loiKetNoi(msg: string): LoiKetNoiMcp {
  const e = new Error(msg) as LoiKetNoiMcp;
  e.loaiLoi = "ket_noi";
  return e;
}

type CauHinhTaoClient = {
  url: string;
  headers: Record<string, string>;
  /** Bắn khi tầng HTTP báo phiên hết hạn (404 cho session id cũ) - xem `mcp-connection-pool.ts`. */
  onMatPhien?: () => void;
  /** Hủy bắt tay khi đã hết giờ - lib tự đóng transport của lần nối dở. */
  signal: AbortSignal;
};

/** Seam test - tiêm hàm dựng client giả thay vì gọi HTTP thật. */
export type ConnectDeps = {
  taoClient: (cfg: CauHinhTaoClient) => Promise<KetNoiMcp>;
};

const depThat: ConnectDeps = {
  taoClient: async ({ url, headers, onMatPhien, signal }) => {
    const client = await createMCPClient({
      transport: { type: "http", url, headers, ...(onMatPhien ? { onSessionExpired: () => onMatPhien() } : {}) },
      initializationOptions: { signal },
    });
    return { tools: () => client.tools(), close: () => client.close() };
  },
};

/**
 * Thua cuộc đua với trần giờ KHÔNG có nghĩa lần nối đã dừng: từ
 * `@ai-sdk/mcp` 2.0.81 bắt tay chờ `server/discover` không còn trần 1 giây
 * riêng, nên một server chậm vẫn có thể nối XONG sau khi mình đã bỏ cuộc. Hai
 * lớp chặn rò handle đó: (1) `signal` bảo lib hủy bắt tay và tự đóng
 * transport; (2) nếu client vẫn về muộn (lib bỏ qua signal, hoặc deps giả
 * trong test) thì đóng nó ngay tại chỗ - không ai khác giữ tham chiếu tới nó.
 */
export async function ketNoiServer(
  cfg: { url: string; headers: Record<string, string>; connectTimeoutMs: number; onMatPhien?: () => void },
  deps: ConnectDeps = depThat,
): Promise<KetNoiMcp> {
  let hen: ReturnType<typeof setTimeout> | undefined;
  let hetGio = false;
  const huy = new AbortController();
  const dangNoi = deps.taoClient({ url: cfg.url, headers: cfg.headers, onMatPhien: cfg.onMatPhien, signal: huy.signal }).then(
    (kn) => {
      if (hetGio) {
        void kn.close().catch(() => {});
      }
      return kn;
    },
    (e: unknown) => {
      throw loiKetNoi(`Không nối được ${cfg.url}: ${e instanceof Error ? e.message : String(e)}`);
    },
  );
  // Nhánh thua cuộc đua vẫn có thể ném sau này - nuốt để không thành unhandled rejection.
  dangNoi.catch(() => {});
  try {
    return await Promise.race([
      dangNoi,
      new Promise<never>((_, reject) => {
        hen = setTimeout(() => {
          hetGio = true;
          huy.abort();
          reject(loiKetNoi(`Nối ${cfg.url} quá ${cfg.connectTimeoutMs}ms`));
        }, cfg.connectTimeoutMs);
      }),
    ]);
  } finally {
    if (hen) clearTimeout(hen);
  }
}
