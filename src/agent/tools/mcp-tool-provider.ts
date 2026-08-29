// Lớp mỏng để tool ngoài (src/mcp) chảy vào registry mà KHÔNG bắt tool-registry
// import chuỗi chạm DB ở module scope. Manager đăng ký nguồn lúc khởi động; test
// đăng ký một hàm thuần. Mặc định rỗng -> chưa có manager thì không tool ngoài nào.
import type { ToolDefinition } from "./tool-catalog-types.js";

let nguon: (agentId: string) => ToolDefinition[] = () => [];

/** Manager (`mcp-manager.ts`) gọi lúc `startMcpManager`; test tiêm hàm giả. */
export function datNguonToolMcp(fn: (agentId: string) => ToolDefinition[]): void {
  nguon = fn;
}

/** `tool-registry.ts` gọi mỗi lượt - đọc nguồn hiện tại, KHÔNG chạm DB trực tiếp. */
export function layToolMcpChoAgent(agentId: string): ToolDefinition[] {
  return nguon(agentId);
}
