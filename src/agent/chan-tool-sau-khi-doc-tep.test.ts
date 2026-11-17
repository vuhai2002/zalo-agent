import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import {
  biTatSauKhiDocTep,
  bocToolBiChan,
  CAU_TOOL_TAM_TAT,
  ghepPrepareStep,
  locToolSauKhiDocTep,
} from "./chan-tool-sau-khi-doc-tep.js";
import { laKetQuaLoi } from "./tools/tool-failure-result.js";

describe("chặn tool sau khi đọc tệp", () => {
  it("danh sách tool bị tắt: ghi bền + tác động người khác + mọi tool MCP", () => {
    for (const k of ["save_memory", "verbatim_note", "schedule_task", "tag_member", "mcp__crm__xoa_khach"]) {
      assert.equal(biTatSauKhiDocTep(k), true, k);
    }
    for (const k of ["web_fetch", "web_search", "doc_file", "send_file", "create_word_document", "kb_search"]) {
      assert.equal(biTatSauKhiDocTep(k), false, k);
    }
    assert.deepEqual(locToolSauKhiDocTep(["web_fetch", "save_memory", "mcp__a__b", "doc_file"]), ["web_fetch", "doc_file"]);
  });

  it("bocToolBiChan: chưa đọc tệp thì chạy gốc; đã đọc thì trả lỗi tạm tắt, KHÔNG chạy gốc", async () => {
    let daChay = 0;
    const goc = tool({ inputSchema: z.object({}), execute: async () => (daChay++, "ok") });
    const trangThai = { daDocTep: false };
    const boc = bocToolBiChan(goc, trangThai);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const exec = (boc as any).execute;
    assert.equal(await exec({}, {}), "ok");
    trangThai.daDocTep = true;
    const kq = await exec({}, {});
    assert.equal(laKetQuaLoi(kq), true);
    assert.equal((kq as { loi: string }).loi, CAU_TOOL_TAM_TAT);
    assert.equal(daChay, 1);
  });

  it("ghepPrepareStep: giữ phần tin chen và thêm activeTools khi đã đọc tệp", async () => {
    const trangThai = { daDocTep: false };
    const chen = async () => ({ messages: [{ role: "user" as const, content: "tin chen" }] });
    const ps = ghepPrepareStep(chen, trangThai, () => ["save_memory", "web_fetch"]);
    assert.deepEqual(await ps([]), { messages: [{ role: "user", content: "tin chen" }] });
    trangThai.daDocTep = true;
    assert.deepEqual(await ps([]), { messages: [{ role: "user", content: "tin chen" }], activeTools: ["web_fetch"] });
    const psRong = ghepPrepareStep(async () => ({}), trangThai, () => ["save_memory", "web_fetch"]);
    assert.deepEqual(await psRong([]), { activeTools: ["web_fetch"] });
  });
});
