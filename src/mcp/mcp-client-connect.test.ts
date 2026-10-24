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

  it("hết giờ rồi client mới nối xong -> client về muộn bị ĐÓNG, signal đã hủy", async () => {
    let daDong = false;
    let tinHieu: AbortSignal | undefined;
    let traVe!: () => void;
    const veMuon = new Promise<void>((r) => (traVe = r));
    await assert.rejects(
      ketNoiServer(
        { url: "https://x/mcp", headers: {}, connectTimeoutMs: 10 },
        depsGia(async ({ signal }) => {
          tinHieu = signal;
          await veMuon;
          return { tools: async () => ({}), close: async () => void (daDong = true) };
        }),
      ),
    );
    assert.equal(tinHieu?.aborted, true, "phải bảo lib hủy bắt tay");
    traVe();
    await new Promise((r) => setImmediate(r));
    assert.equal(daDong, true, "client về muộn không ai giữ - phải tự đóng, không thì rò");
  });

  it("nối kịp giờ -> KHÔNG bị đóng", async () => {
    let daDong = false;
    await ketNoiServer(
      { url: "https://x/mcp", headers: {}, connectTimeoutMs: 1000 },
      depsGia(async () => ({ tools: async () => ({}), close: async () => void (daDong = true) })),
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(daDong, false);
  });
});
