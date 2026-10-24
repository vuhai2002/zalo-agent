import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonSchema, tool, type Tool } from "ai";
import { z } from "zod";
import { ghiChuToolBiBo, locToolKhamPha, moTaAnToan } from "./mcp-tool-discovery-filter.js";

const toolZod = (): Tool => tool({ description: "x", inputSchema: z.object({}), execute: async () => "ok" });
const toolJson = (schema: object): Tool =>
  tool({ description: "x", inputSchema: jsonSchema(schema as never), execute: async () => "ok" });

describe("locToolKhamPha", () => {
  it("giữ tool schema object (zod lẫn JSON schema thô), giữ thứ tự server", async () => {
    const kq = await locToolKhamPha({ b: toolZod(), a: toolJson({ type: "object", properties: {} }) });
    assert.deepEqual(Object.keys(kq.hopLe), ["b", "a"]);
    assert.equal(kq.saiSchema, 0);
    assert.equal(ghiChuToolBiBo(kq), "");
  });

  it("bỏ tool có inputSchema không phải object (thiếu type / type khác)", async () => {
    const kq = await locToolKhamPha({
      tot: toolZod(),
      thieuType: toolJson({ properties: {} }),
      chuoi: toolJson({ type: "string" }),
    });
    assert.deepEqual(Object.keys(kq.hopLe), ["tot"]);
    assert.equal(kq.saiSchema, 2);
    assert.match(ghiChuToolBiBo(kq), /2 tool có tham số không phải object/);
  });

  it("vượt trần số tool -> chỉ giữ N tool đầu, đếm phần bị bỏ", async () => {
    const tools = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`t${i}`, toolZod()]));
    const kq = await locToolKhamPha(tools, 3);
    assert.deepEqual(Object.keys(kq.hopLe), ["t0", "t1", "t2"]);
    assert.equal(kq.vuotTran, 2);
  });
});

describe("moTaAnToan", () => {
  it("lọc dải Tags khỏi mô tả, không phải chuỗi -> rỗng", () => {
    const an = String.fromCodePoint(0xe0049, 0xe0047);
    assert.equal(moTaAnToan(`tra cứu${an}`), "tra cứu");
    assert.equal(moTaAnToan(() => "dong"), "");
  });
});
