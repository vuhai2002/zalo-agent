import { createHash } from "node:crypto";
import { tool, type Tool } from "ai";
import { ketQuaLoi } from "../agent/tools/tool-failure-result.js";
import type { ToolDefinition } from "../agent/tools/tool-catalog-types.js";
import { wrapUntrustedContent } from "../agent/tools/wrap-untrusted-content.js";

/**
 * Đổi MỘT tool lấy từ `client.tools()` của một MCP server ngoài thành
 * `ToolDefinition` nội bộ - có đủ hai cửa default-deny mà mọi tool khác trong
 * catalog đều phải qua (xem `tool-catalog-types.ts`).
 *
 * Đây là LÕI BẢO MẬT của tính năng MCP client: server ngoài do người vận hành
 * tự thêm, nhưng nội dung nó TRẢ VỀ vẫn là dữ liệu không tin cậy y hệt một
 * trang web (server có thể bị compromise, hoặc chính server cố tình trả nội
 * dung mang chỉ thị). Mọi output đi qua `wrapUntrustedContent`, mọi nhánh hỏng
 * (ném / hết giờ / mất quyền giữa lượt) trả `ketQuaLoi` chứ không ném ra
 * agent loop - đúng quy ước chung của repo (xem `tool-failure-result.ts`).
 *
 * `kiemGan` được TIÊM thay vì gọi thẳng `serversCuaAgent` (mirror `agent_mcp_servers`)
 * - lệch spec CÓ CHỦ Ý để test lõi không phải dựng DB. `mcp-manager.ts` (phase
 * sau) truyền `kiemGan = (agentId) => serversCuaAgent(agentId).includes(serverId)`.
 */

/**
 * Tên tool gửi cho LLM: tiền tố `mcp__<slug server>__` chống trùng tên với
 * tool nội bộ hoặc tool cùng tên của server MCP khác.
 *
 * Chuẩn hóa `serverTen` về chữ thường + `[a-z0-9_]` có thể MẤT THÔNG TIN (dấu
 * tiếng Việt, ký tự đặc biệt đều gộp về `_`) - hai server tên KHÁC NHAU hoàn
 * toàn có thể chuẩn hóa về CÙNG một slug. Không hash thì hai server đó sinh
 * CÙNG một `key`, và tool của server nối sau sẽ ÂM THẦM ĐÈ tool của server
 * nối trước trong object tools gửi model (key trùng trong `Record<string,Tool>`)
 * - một tool bị vô hiệu mà không lỗi nào báo, đúng lớp lỗi nguy hiểm nhất vì
 * im lặng. Tên SẠCH (chuẩn hóa không đổi gì, key không vượt trần) thì KHÔNG
 * hash - 2 server trùng tên SẠCH (vd cùng đặt "Notion") là dư số chấp nhận
 * được ở V1, tự người vận hành nhìn tên là biết trùng, không phải lớp lỗi ÂM
 * THẦM như trên.
 *
 * `toolTen` do SERVER NGOÀI tự đặt (không phải người vận hành nhập), nên
 * KHÔNG có gì đảm bảo nó khớp charset tên hàm mà API model chấp nhận
 * (thường chỉ `[A-Za-z0-9_-]`, có trần độ dài quanh 64 ký tự) - thiếu lọc thì
 * một server thật gửi tool tên có dấu cách/unicode/quá dài sẽ làm request gọi
 * model bị provider từ chối thẳng, hỏng CẢ LƯỢT chứ không riêng tool đó. Nên
 * `toolTen` cũng qua cùng vòng chuẩn hóa + CẮT TRẦN CẢ KEY về 64 ký tự.
 *
 * Khi có mất mát (server HOẶC tool) hoặc key vượt trần, nối thêm 8 ký tự đầu
 * của `sha256(serverId + toolTen gốc)` - băm cả hai vì hai tool CÙNG serverId
 * nhưng khác `toolTen` (vd 2 tool dài trùng tiền tố, khác đuôi) vẫn phải ra
 * key khác nhau sau khi bị cắt cùng một tiền tố. `serverId` luôn DUY NHẤT
 * (`randomBytes(8).hex`, xem `mcp-server-store.ts`).
 */
export function tenToolMcp(serverTen: string, toolTen: string, serverId: string): string {
  const tenThuong = serverTen.toLowerCase();
  const slug = tenThuong.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const base = slug || "server";
  const toolSach = toolTen.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
  const matMat = slug === "" || slug !== tenThuong || toolSach !== toolTen;
  let key = `mcp__${base}__${toolSach}`;
  if (matMat || key.length > 64) {
    const hauTo = `_${createHash("sha256").update(`${serverId}\u0000${toolTen}`).digest("hex").slice(0, 8)}`;
    const doDaiToiDaGoc = 64 - hauTo.length;
    key = (key.length > doDaiToiDaGoc ? key.slice(0, doDaiToiDaGoc) : key) + hauTo;
  }
  return key;
}

/**
 * Kết quả `aiTool.execute` của `@ai-sdk/mcp` có thể ở 3 dạng tùy server:
 * chuỗi trần, `{content:[{type:'text',text}]}` (dạng chuẩn MCP content block),
 * hoặc bất kỳ giá trị JSON nào khác (server không tuân thủ chuẩn) - dạng cuối
 * hạ về `JSON.stringify` để không đánh rơi dữ liệu.
 *
 * `null`/`undefined` (tool chạy xong nhưng không trả gì) hạ về chuỗi RỖNG
 * tường minh - KHÔNG để lọt xuống `JSON.stringify(undefined)`, vì hàm đó trả
 * đúng giá trị `undefined` (không phải chuỗi `"undefined"`) dù kiểu khai báo
 * của `JSON.stringify` nói là `string`. Sai kiểu ngầm đó, nếu không chặn ở
 * đây, sẽ làm caller (`taoToolDefinitionMcp`) gọi `.length` trên `undefined`
 * rồi ném - biến một kết quả RỖNG HỢP LỆ thành một "lỗi giả".
 */
export function trichVanBanKetQuaMcp(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { content?: unknown }).content)) {
    const parts = (raw as { content: unknown[] }).content
      .filter(
        (c): c is { type: string; text: string } =>
          !!c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string",
      )
      .map((c) => c.text);
    if (parts.length) return parts.join("\n");
  }
  // Lưới cuối: giá trị nào cũng khiến JSON.stringify trả `undefined` (hàm,
  // symbol...) thì vẫn phải ra CHUỖI - cùng lý do ở đoạn docstring trên.
  return JSON.stringify(raw) ?? "";
}

/**
 * Ép một promise phải xong trong `ms`, ném nếu không. Server MCP ngoài không
 * do mình vận hành nên có thể treo vô thời hạn - không có trần thì một lời
 * gọi tool đơn lẻ giữ lượt agent sống mãi mãi.
 *
 * KHÔNG hủy được `fn()` khi thua cuộc đua (JS không có cancel token cho
 * promise) - promise gốc vẫn chạy ngầm tới khi tự xong/tự ném, chỉ là kết quả
 * của nó không còn ai đợi. Chấp nhận được: cùng đánh đổi với các chỗ
 * `Promise.race` timeout khác trong repo (`gui-video-qua-zalo.ts`).
 *
 * EXPORT (không chỉ dùng nội bộ file này): `mcp-manager.ts` tái dùng để bọc
 * `ketNoi.tools()` lúc khám phá tool - cùng một rủi ro treo vô hạn, không lý
 * do gì viết lại một bản thứ hai.
 */
export async function goiCoTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new Error(`quá ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export function taoToolDefinitionMcp(p: {
  serverId: string;
  serverTen: string;
  toolTen: string;
  moTa: string;
  /** Tool gốc lấy từ `client.tools()[toolTen]` của `@ai-sdk/mcp`. */
  aiTool: Tool;
  toolCallTimeoutMs: number;
  /** Cửa bảo mật: agent này CÒN được cấp server này không. Xem docstring đầu file. */
  kiemGan: (agentId: string) => boolean;
}): ToolDefinition {
  const { serverId, serverTen, toolTen, moTa, aiTool, toolCallTimeoutMs, kiemGan } = p;
  return {
    key: tenToolMcp(serverTen, toolTen, serverId),
    label: `${serverTen}: ${toolTen}`,
    description: moTa,
    group: "action",
    // Job scheduler không có luồng gán/enrich MCP cho lượt cô lập, và tool
    // ngoài luôn xếp nhóm rủi ro cao nhất (xem `keTrongKhaNang` bên dưới) -
    // mirror lý do 9 tool khác đã bị loại khỏi lượt lịch (tool-catalog-types.ts).
    runsInScheduledTurn: false,
    // Không quảng cáo trong "bạn làm được gì" - danh sách tool ngoài đổi theo
    // cấu hình dashboard, khoe một tool có thể bị gỡ quyền bất kỳ lúc nào chỉ
    // gây hiểu nhầm.
    keTrongKhaNang: false,
    // Cửa 1 (default-deny lúc dựng schema): chưa gán -> tool không vào schema,
    // model không hề biết nó tồn tại.
    available: (scope) => kiemGan(scope.agent.id),
    build: (ctx) =>
      tool({
        description: moTa,
        inputSchema: aiTool.inputSchema,
        execute: async (args, opts) => {
          // Cửa 2 (recheck fail-closed): phòng ca gỡ quyền GIỮA lượt (agent bị
          // rút server sau khi schema đã dựng cho lượt đang chạy) - KHÔNG được
          // bỏ, đây là dòng phá-kiểm bắt buộc của phase.
          if (!kiemGan(ctx.agent.id)) {
            return ketQuaLoi("Tool ngoài không còn được cấp cho agent này");
          }
          try {
            const raw = await goiCoTimeout(() => aiTool.execute!(args, opts), toolCallTimeoutMs);
            // Nội dung KHÔNG tin cậy - server ngoài không do mình kiểm soát.
            // Rỗng/undefined KHÔNG phải lỗi (tool chạy xong, chỉ là không có
            // gì để nói) - nhưng `wrapUntrustedContent("")` trả nguyên chuỗi
            // rỗng KHÔNG BỌC (xem lưới an toàn đầu file đó), nên phải lấp
            // placeholder TRƯỚC khi bọc để nhánh này vẫn có ranh giới, thay vì
            // âm thầm rơi vào catch bên dưới rồi biến thành "lỗi giả".
            const text = trichVanBanKetQuaMcp(raw);
            return wrapUntrustedContent(text || "(tool ngoài không trả nội dung)", `MCP ${serverTen}/${toolTen}`);
          } catch (e) {
            return ketQuaLoi(`Tool ngoài "${toolTen}" lỗi: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      }),
  };
}
