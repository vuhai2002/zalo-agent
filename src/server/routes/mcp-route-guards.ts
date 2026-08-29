import { z } from "zod";

/**
 * Guard Zod cho `/api/mcp` (`mcp-routes.ts`). Tách riêng để file route giữ
 * dưới 200 dòng - cùng lý do `kb-route-guards.ts` tách khỏi `kb-routes.ts`.
 *
 * "ten" hiển thị trên dashboard NHƯNG cũng đi thẳng vào label tool gửi cho LLM
 * (`mcp-tool-definition.ts`: `label = "<serverTen>: <toolTen>"`) và nhãn
 * `wrapUntrustedContent` - chặn ở biên thay vì để một chuỗi khổng lồ lọt vào
 * schema tool của mọi lượt agent dùng server này. `.max(200)` khớp
 * `tenNguonSchema` (kb-route-guards.ts) - cùng vai trò "tên hiển thị".
 */
const tenServerSchema = z.string().min(1).max(200);
const urlServerSchema = z.string().url().max(2048);

// Header xác thực (vd Authorization) - admin tự nhập, không phải nội dung
// người lạ, nhưng vẫn chặn trần để tránh một giá trị khổng lồ lọt vào
// encryptSecret(JSON.stringify(...)) rồi nằm mãi trong DB.
const headersSchema = z.record(z.string().max(200), z.string().max(4000)).optional();

export const taoServerSchema = z.object({
  ten: tenServerSchema,
  url: urlServerSchema,
  headers: headersSchema,
  enabled: z.boolean().optional(),
});

export const suaServerSchema = z.object({
  ten: tenServerSchema.optional(),
  url: urlServerSchema.optional(),
  headers: headersSchema,
  enabled: z.boolean().optional(),
});

// serverIds/agentIds: id thật là hex 16 ký tự (`randomBytes(8).hex`, xem
// mcp-server-store.ts) hoặc slug agent vài chục ký tự - `.max(64)` mỗi phần tử
// + trần tổng mirror đúng `putAgentSourcesSchema`/`putSourceAgentsSchema`
// (kb-route-guards.ts): thiếu trần phần tử thì trần tổng không ngăn được MỘT
// phần tử khổng lồ một mình nuốt RAM trước khi kịp kiểm gì.
export const ganServerSchema = z.object({ serverIds: z.array(z.string().max(64)).max(500) });
export const ganAgentSchema = z.object({ agentIds: z.array(z.string().max(64)).max(200) });
