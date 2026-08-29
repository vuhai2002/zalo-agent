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

/** Seam test - tiêm hàm dựng client giả thay vì gọi HTTP thật. */
export type ConnectDeps = {
  taoClient: (cfg: { url: string; headers: Record<string, string> }) => Promise<KetNoiMcp>;
};

const depThat: ConnectDeps = {
  taoClient: async ({ url, headers }) => {
    const client = await createMCPClient({ transport: { type: "http", url, headers } });
    return { tools: () => client.tools(), close: () => client.close() };
  },
};

export async function ketNoiServer(
  cfg: { url: string; headers: Record<string, string>; connectTimeoutMs: number },
  deps: ConnectDeps = depThat,
): Promise<KetNoiMcp> {
  let hen: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      deps.taoClient({ url: cfg.url, headers: cfg.headers }).catch((e) => {
        throw loiKetNoi(`Không nối được ${cfg.url}: ${e instanceof Error ? e.message : String(e)}`);
      }),
      new Promise<never>((_, reject) => {
        hen = setTimeout(() => reject(loiKetNoi(`Nối ${cfg.url} quá ${cfg.connectTimeoutMs}ms`)), cfg.connectTimeoutMs);
      }),
    ]);
  } finally {
    if (hen) clearTimeout(hen);
  }
}
