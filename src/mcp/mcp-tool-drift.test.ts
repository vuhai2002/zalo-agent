import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { chupFingerprint, soDrift } from "./mcp-tool-drift.js";

/**
 * `them=true` thêm tool `xoa` vào bộ - dùng để mô phỏng server MCP đổi danh
 * sách tool ngầm (rug pull) giữa hai lần kết nối.
 */
const boTool = (them = false) => ({
  tra_cuu: tool({ description: "tra cuu", inputSchema: z.object({ q: z.string() }), execute: async () => "ok" }),
  ...(them ? { xoa: tool({ description: "xoa", inputSchema: z.object({}), execute: async () => "ok" }) } : {}),
});

describe("mcp-tool-drift", () => {
  it("cùng bộ tool -> không drift", async () => {
    const moc = await chupFingerprint(boTool());
    const kq = await soDrift(boTool(), moc);
    assert.equal(kq.drift, false);
  });

  it("thêm 1 tool -> drift, 'them' có tên nó", async () => {
    const moc = await chupFingerprint(boTool(false));
    const kq = await soDrift(boTool(true), moc);
    assert.equal(kq.drift, true);
    assert.ok(kq.them.includes("xoa"));
  });

  it("mốc rỗng -> không coi là drift", async () => {
    const kq = await soDrift(boTool(), "");
    assert.equal(kq.drift, false);
  });

  it("đổi input schema của tool CÙNG TÊN -> drift, 'doi' có tên nó", async () => {
    // Mối đe dọa rug-pull thật: server không đổi TÊN tool (nên "thêm/bớt" ở
    // trên không bắt được) mà đổi NGẦM input schema - vd thêm field bắt buộc
    // để dụ model gửi kèm dữ liệu nó không lẽ ra không nên gửi.
    const baseline = {
      x: tool({ description: "x", inputSchema: z.object({ a: z.string() }), execute: async () => "ok" }),
    };
    const moc = await chupFingerprint(baseline);
    const sau = {
      x: tool({
        description: "x",
        inputSchema: z.object({ a: z.string(), b: z.string() }),
        execute: async () => "ok",
      }),
    };
    const kq = await soDrift(sau, moc);
    assert.equal(kq.drift, true);
    assert.ok(kq.doi.includes("x"));
  });
});
