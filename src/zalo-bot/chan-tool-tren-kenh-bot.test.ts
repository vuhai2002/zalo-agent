import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAvailableTools, kiemTraKhaDung } from "../agent/tools/tool-registry.js";
import { TOOL_DEFINITIONS } from "../agent/tools/tool-catalog.js";
import type { ToolScope } from "../agent/tools/tool-catalog-types.js";

const agent = { id: "a1", disabledTools: [] };
const KENH_BOT: ToolScope = { agent, account: { disabledTools: [], loai: "bot" } };
const KENH_CA_NHAN: ToolScope = { agent, account: { disabledTools: [], loai: "ca_nhan" } };

const keys = (s: ToolScope) => listAvailableTools(s).map((t) => t.key);

describe("chặn tool trên kênh bot", () => {
  it("7 tool đụng kênh KHÔNG vào schema của lượt chạy trên bot", () => {
    // Đây là chốt thật sự: tool không nằm trong danh sách này thì model KHÔNG
    // nhận được schema của nó, nên không gọi được, nên không hứa được.
    const tren = keys(KENH_BOT);
    for (const k of [
      "send_file",
      "create_word_document",
      "create_excel_file",
      "create_image",
      "add_reaction",
      "tag_member",
      "get_group_info",
    ]) {
      assert.ok(!tren.includes(k), `"${k}" vẫn vào schema trên kênh bot`);
    }
  });

  it("kênh cá nhân KHÔNG bị chặn gì thêm - chỉ kênh bot mới hẹp lại", () => {
    // Chốt chống "sửa cho bot làm hỏng luôn kênh đang chạy". Đây là hồi quy
    // đắt nhất có thể xảy ra ở bước nối này.
    const caNhan = keys(KENH_CA_NHAN);
    for (const k of ["send_file", "create_image", "add_reaction", "tag_member", "get_group_info"]) {
      assert.ok(caNhan.includes(k), `"${k}" bị chặn nhầm trên kênh cá nhân`);
    }
  });

  it("tool thuần vẫn chạy trên kênh bot", () => {
    const tren = keys(KENH_BOT);
    for (const k of ["get_datetime", "web_search", "web_fetch", "save_memory", "schedule_task"]) {
      assert.ok(tren.includes(k), `"${k}" bị chặn nhầm trên kênh bot`);
    }
  });

  it("kênh bot hẹp hơn kênh cá nhân ĐÚNG 7 tool, không hơn không kém", () => {
    // Đếm hiệu hai tập thay vì liệt kê lại: thêm tool mới vào danh sách chặn mà
    // quên cập nhật ở đây thì test đỏ, buộc phải xem lại con số.
    const chenhLech = keys(KENH_CA_NHAN).filter((k) => !keys(KENH_BOT).includes(k));
    assert.equal(chenhLech.length, 7, `lệch ${chenhLech.length} tool: ${chenhLech.join(", ")}`);
  });

  it("lý do chặn nói rõ là giới hạn Zalo, để dashboard hiện đúng nguyên nhân", () => {
    const def = TOOL_DEFINITIONS.find((t) => t.key === "send_file")!;
    const kq = kiemTraKhaDung(def, KENH_BOT);
    assert.equal(kq.khaDung, false);
    assert.match(kq.hint ?? "", /Zalo Bot API/);
  });

  it("giới hạn nền tảng THẮNG cả khi tool được bật trên dashboard", () => {
    // Người vận hành bật "Gửi file" cho tài khoản bot là chuyện sẽ xảy ra -
    // dashboard không cấm. Bật kiểu gì cũng phải hỏng, và hỏng theo cách người
    // nhắn tưởng agent bị lỗi. Nên giới hạn nền tảng phải thắng.
    const batHet: ToolScope = { agent: { id: "a1", disabledTools: [] }, account: { disabledTools: [], loai: "bot" } };
    assert.ok(!keys(batHet).includes("send_file"));
  });
});
