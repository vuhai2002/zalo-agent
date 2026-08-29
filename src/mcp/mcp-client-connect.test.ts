import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ketNoiServer, type ConnectDeps } from "./mcp-client-connect.js";

const depsGia = (impl: ConnectDeps["taoClient"]): ConnectDeps => ({ taoClient: impl });

describe("ketNoiServer", () => {
  it("nối ok trả handle có tools()/close()", async () => {
    const kn = await ketNoiServer(
      { url: "https://x/mcp", headers: {}, connectTimeoutMs: 1000 },
      depsGia(async () => ({ tools: async () => ({}), close: async () => {} })),
    );
    assert.equal(typeof kn.tools, "function");
    assert.equal(typeof kn.close, "function");
  });

  it("nối treo quá timeout -> ném LoiKetNoiMcp", async () => {
    await assert.rejects(
      ketNoiServer(
        { url: "https://x/mcp", headers: {}, connectTimeoutMs: 10 },
        depsGia(() => new Promise(() => {})), // không bao giờ resolve
      ),
      (e: unknown) => (e as { loaiLoi?: string }).loaiLoi === "ket_noi",
    );
  });
});
