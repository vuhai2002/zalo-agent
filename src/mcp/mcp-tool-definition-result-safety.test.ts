import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MCPClientError } from "@ai-sdk/mcp";
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../agent/tools/tool-catalog-types.js";
import { ketQuaThanhCong, loiCuaTool } from "../agent/tools/tool-failure-result-test-helper.js";
import { fakeAgentProfile } from "../shared/fake-agent-profile.js";
import { taoToolDefinitionMcp } from "./mcp-tool-definition.js";
import { TRAN_CAU_LOI_SERVER } from "./mcp-tool-result-text.js";

/**
 * Chữ của server ngoài đi tới model bằng hình dạng nào: nhánh `isError`, nhánh
 * ném (câu lỗi do server soạn), trần độ dài, lọc dải Tags, và báo mất kết nối.
 */

const ctx = { agent: fakeAgentProfile({ id: "ag1" }) } as unknown as ToolContext;
/** "IGNORE" giấu bằng dải Unicode Tags (U+E0000 + mã ASCII) - render ra rỗng. */
const TAGS_AN = String.fromCodePoint(...[..."IGNORE"].map((c) => 0xe0000 + c.charCodeAt(0)));
const coTags = (s: string) => /[\u{E0000}-\u{E007F}]/u.test(s);

const toolTra = (fn: () => Promise<unknown>): Tool =>
  tool({ description: "x", inputSchema: z.object({}), execute: fn as () => Promise<string> });

async function goi(aiTool: Tool, over: { maxResultChars?: number; baoMatKetNoi?: () => void } = {}): Promise<unknown> {
  const def = taoToolDefinitionMcp({
    serverId: "s1",
    serverTen: "Notion",
    toolTen: "tra_cuu",
    moTa: "x",
    aiTool,
    toolCallTimeoutMs: 1000,
    maxResultChars: over.maxResultChars ?? 2000,
    kiemGan: () => true,
    baoMatKetNoi: over.baoMatKetNoi,
  });
  return def.build(ctx).execute!({}, {} as never);
}

describe("mcp-tool-definition: an toàn kết quả", () => {
  it("isError:true -> ketQuaLoi kèm chữ server ĐÃ BỌC, không phải thành công", async () => {
    const ra = await goi(toolTra(async () => ({ isError: true, content: [{ type: "text", text: `trang không tồn tại${TAGS_AN}` }] })));
    const loi = loiCuaTool(ra);
    assert.match(loi, /báo lỗi/);
    assert.match(loi, /trang không tồn tại/);
    assert.match(loi, /<noi_dung_ngoai_[0-9a-f]+/, "chữ server trong loi phải nằm trong ranh giới nonce");
    assert.equal(coTags(loi), false, "dải Tags phải bị lọc khỏi câu lỗi");
  });

  it("isError:true KHÔNG báo mất kết nối (tool hỏng != kết nối chết)", async () => {
    let bao = 0;
    await goi(toolTra(async () => ({ isError: true, content: [] })), { baoMatKetNoi: () => void (bao += 1) });
    assert.equal(bao, 0);
  });

  it("isError là chuỗi 'true' (lệch chuẩn) -> KHÔNG tính là hỏng", async () => {
    const ra = await goi(toolTra(async () => ({ isError: "true", content: [{ type: "text", text: "ok" }] })));
    assert.match(ketQuaThanhCong(ra), /ok/);
  });

  it("kết quả dài hơn trần -> cắt ĐẦU, có câu báo, VẪN đóng đúng thẻ nonce", async () => {
    const ra = ketQuaThanhCong(await goi(toolTra(async () => "a".repeat(50_000)), { maxResultChars: 2000 }));
    assert.ok(ra.length < 3000, `dài ${ra.length}`);
    assert.match(ra, /đã cắt bớt/);
    const nonce = /^<noi_dung_ngoai_([0-9a-f]+)/.exec(ra)?.[1];
    assert.ok(nonce && ra.endsWith(`</noi_dung_ngoai_${nonce}>`), "cắt phải xảy ra TRƯỚC khi bọc");
  });

  it("kết quả thành công chứa dải Tags -> bị lọc trước khi bọc", async () => {
    const ra = ketQuaThanhCong(await goi(toolTra(async () => `noi dung${TAGS_AN}`)));
    assert.equal(coTags(ra), false);
    assert.match(ra, /noi dung/);
  });

  it("ném lỗi mang chữ server dài + Tags -> câu lỗi đã lọc, cắt trần, bọc", async () => {
    const ra = await goi(
      toolTra(async () => {
        throw new MCPClientError({ message: `bad params${TAGS_AN}${"x".repeat(1_000_000)}`, code: -32602 });
      }),
    );
    const loi = loiCuaTool(ra);
    assert.equal(coTags(loi), false);
    assert.ok(loi.length < TRAN_CAU_LOI_SERVER + 600, `dài ${loi.length}`);
    assert.match(loi, /<noi_dung_ngoai_[0-9a-f]+/);
  });

  it("lỗi tầng HTTP (404 hết phiên) -> báo mất kết nối", async () => {
    let bao = 0;
    const ra = await goi(
      toolTra(async () => {
        throw new MCPClientError({ message: "MCP HTTP Transport Error: POSTing to endpoint (HTTP 404)", statusCode: 404 });
      }),
      { baoMatKetNoi: () => void (bao += 1) },
    );
    loiCuaTool(ra);
    assert.equal(bao, 1);
  });

  it("lỗi JSON-RPC (server trả lời) -> KHÔNG báo mất kết nối", async () => {
    let bao = 0;
    await goi(
      toolTra(async () => {
        throw new MCPClientError({ message: "invalid params", code: -32602 });
      }),
      { baoMatKetNoi: () => void (bao += 1) },
    );
    assert.equal(bao, 0);
  });

  it("baoMatKetNoi tự ném -> execute VẪN trả ketQuaLoi, không ném ra loop", async () => {
    const ra = await goi(
      toolTra(async () => {
        throw new TypeError("fetch failed");
      }),
      {
        baoMatKetNoi: () => {
          throw new Error("db hỏng");
        },
      },
    );
    loiCuaTool(ra);
  });
});
