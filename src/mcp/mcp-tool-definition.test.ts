import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../agent/tools/tool-catalog-types.js";
import { fakeAgentProfile } from "../shared/fake-agent-profile.js";
import { ketQuaThanhCong, loiCuaTool } from "../agent/tools/tool-failure-result-test-helper.js";
import { taoToolDefinitionMcp, tenToolMcp, trichVanBanKetQuaMcp } from "./mcp-tool-definition.js";

const ctx = (id: string) => ({ agent: fakeAgentProfile({ id }) }) as unknown as ToolContext;
const aiToolThat = tool({
  description: "tra cuu",
  inputSchema: z.object({ q: z.string() }),
  execute: async () => "ket qua tho",
});

const dungDef = (over: Partial<Parameters<typeof taoToolDefinitionMcp>[0]> = {}) =>
  taoToolDefinitionMcp({
    serverId: "s1",
    serverTen: "Notion",
    toolTen: "tra_cuu",
    moTa: "tra cuu",
    aiTool: aiToolThat,
    toolCallTimeoutMs: 1000,
    kiemGan: () => true,
    ...over,
  });

describe("mcp-tool-definition", () => {
  it("tenToolMcp có tiền tố chống trùng, tên SẠCH không hash thừa", () => {
    assert.equal(tenToolMcp("Notion", "tra_cuu", "s1"), "mcp__notion__tra_cuu");
  });

  it("2 server tên MẤT MÁT giống nhau (chuẩn hóa trùng slug) nhưng serverId khác -> key KHÁC NHAU", () => {
    // "Tra cứu" mất dấu khi chuẩn hóa (dấu tiếng Việt -> "_") - đúng ca lossy
    // cần hash chống 1 server đè tool của server kia.
    const k1 = tenToolMcp("Tra cứu", "tool_a", "server-1");
    const k2 = tenToolMcp("Tra cứu", "tool_a", "server-2");
    assert.notEqual(k1, k2);
  });

  it("trichVanBanKetQuaMcp xử 3 dạng + null/undefined -> rỗng", () => {
    assert.equal(trichVanBanKetQuaMcp("x"), "x");
    assert.equal(trichVanBanKetQuaMcp({ content: [{ type: "text", text: "a" }] }), "a");
    assert.equal(trichVanBanKetQuaMcp({ code: 1 }), JSON.stringify({ code: 1 }));
    assert.equal(trichVanBanKetQuaMcp(undefined), "");
    assert.equal(trichVanBanKetQuaMcp(null), "");
  });

  it("gán + execute ok -> kết quả BỌC trong <noi_dung_ngoai>", async () => {
    const def = dungDef();
    const ra = await def.build(ctx("ag1")).execute!({ q: "abc" }, {} as never);
    assert.match(ketQuaThanhCong(ra), /<noi_dung_ngoai_/);
  });

  it("aiTool ném -> ketQuaLoi (không ném ra loop)", async () => {
    const nem = tool({
      description: "x",
      inputSchema: z.object({}),
      // Ghi rõ kiểu trả về (Promise<string>) - hàm luôn ném nên TS không tự suy
      // được OUTPUT, để mặc định thì rơi vào overload `execute?: never` của
      // `tool()` và báo lỗi biên dịch dù hành vi runtime không đổi.
      execute: async (): Promise<string> => {
        throw new Error("sap");
      },
    });
    const ra = await dungDef({ aiTool: nem }).build(ctx("ag1")).execute!({}, {} as never);
    assert.match(loiCuaTool(ra), /lỗi/);
  });

  it("aiTool.execute trả undefined -> VẪN BỌC (rỗng không phải lỗi giả)", async () => {
    const rong = tool({
      description: "x",
      inputSchema: z.object({}),
      execute: async (): Promise<string | undefined> => undefined,
    });
    const ra = await dungDef({ aiTool: rong }).build(ctx("ag1")).execute!({}, {} as never);
    assert.match(ketQuaThanhCong(ra), /<noi_dung_ngoai_/);
  });

  it("KHÔNG gán -> recheck chặn (cửa 2)", async () => {
    const ra = await dungDef({ kiemGan: () => false }).build(ctx("ag1")).execute!({ q: "x" }, {} as never);
    assert.match(loiCuaTool(ra), /không còn được cấp/);
  });

  it("execute treo quá timeout -> ketQuaLoi", async () => {
    const treo = tool({
      description: "x",
      inputSchema: z.object({}),
      // `Promise<string>` tường minh - executor không gọi resolve/reject nên
      // treo vĩnh viễn (đúng ý test), nhưng cần kiểu tường minh vì lý do như
      // trên (TS không suy được OUTPUT từ một executor không bao giờ gọi resolve).
      execute: () => new Promise<string>(() => {}),
    });
    const ra = await dungDef({ aiTool: treo, toolCallTimeoutMs: 20 }).build(ctx("ag1")).execute!({}, {} as never);
    assert.ok(loiCuaTool(ra).length > 0);
  });

  it("available theo kiemGan", () => {
    assert.equal(
      dungDef({ kiemGan: () => false }).available!({
        agent: { id: "ag1", disabledTools: [] },
        account: { disabledTools: [], loai: "ca_nhan" },
      }),
      false,
    );
  });

  it("group action + không vào lượt lịch + không quảng cáo trong khả năng", () => {
    const def = dungDef();
    assert.equal(def.group, "action");
    assert.equal(def.runsInScheduledTurn, false);
    assert.equal(def.keTrongKhaNang, false);
  });
});
