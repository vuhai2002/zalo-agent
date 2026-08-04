import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentDetailForm } from "./agent-detail-form.js";
import { DUONG_DAN_TAO, canPatchSauKhiTao, idDaCoRoi, tuBanNhap } from "./agent-draft.js";

const BAN_NHAP = { id: "cham-soc", name: "Chăm Sóc", icon: "💼", persona: "Xưng em với khách" };

function form(patch: Partial<AgentDetailForm> = {}): AgentDetailForm {
  return { ...tuBanNhap(BAN_NHAP), ...patch };
}

describe("tuBanNhap", () => {
  it("giữ nguyên tên, icon, persona người dùng đã nhập ở modal", () => {
    // id KHÔNG nằm trong form: nó còn sửa được ở trang tạo nên trang giữ riêng
    const f = tuBanNhap(BAN_NHAP);
    assert.equal(f.name, "Chăm Sóc");
    assert.equal(f.icon, "💼");
    assert.equal(f.persona, "Xưng em với khách");
  });

  it("mọi ô override để RỖNG - rỗng nghĩa là theo trang Cấu hình chung", () => {
    const f = tuBanNhap(BAN_NHAP);
    assert.equal(f.maxSteps, "");
    assert.equal(f.reasoningEffort, "");
    assert.equal(f.contextWindow, "");
    assert.deepEqual(f.disabledTools, []);
  });
});

describe("canPatchSauKhiTao", () => {
  it("bản nhập chưa đụng ô nào thì KHÔNG cần PATCH - một POST là xong", () => {
    assert.equal(canPatchSauKhiTao(form()), false);
  });

  it("mỗi ô mà `createSchema` không nhận đều tự bắt phải PATCH thêm", () => {
    assert.equal(canPatchSauKhiTao(form({ maxSteps: "12" })), true);
    assert.equal(canPatchSauKhiTao(form({ reasoningEffort: "high" })), true);
    assert.equal(canPatchSauKhiTao(form({ contextWindow: "200000" })), true);
    assert.equal(canPatchSauKhiTao(form({ disabledTools: ["web_search"] })), true);
  });

  it("ô toàn khoảng trắng vẫn coi là chưa đặt gì", () => {
    assert.equal(canPatchSauKhiTao(form({ maxSteps: "   ", contextWindow: " " })), false);
  });

  it("đổi tên hay persona thì KHÔNG cần PATCH - POST đã mang hai trường đó rồi", () => {
    assert.equal(canPatchSauKhiTao(form({ name: "Tên khác", persona: "Giọng khác" })), false);
  });
});

describe("idDaCoRoi", () => {
  it("trùng đúng một id đang có thì báo trùng", () => {
    assert.equal(idDaCoRoi("cham-soc", ["tro-ly-mac-dinh", "cham-soc"]), true);
  });

  it("chưa ai dùng thì không báo", () => {
    assert.equal(idDaCoRoi("cham-soc", ["tro-ly-mac-dinh"]), false);
  });

  it("id rỗng KHÔNG phải là trùng - đó là 'chưa gõ tên', ô ID tự lo câu khác", () => {
    assert.equal(idDaCoRoi("", ["tro-ly-mac-dinh", ""]), false);
  });
});

describe("DUONG_DAN_TAO", () => {
  it("không thể là id agent hợp lệ, nên không route nào che nhau", () => {
    // Cùng regex với `createSchema` ở src/server/routes/agent-routes.ts
    const doanCuoi = DUONG_DAN_TAO.split("/").pop()!;
    assert.equal(/^[a-z0-9][a-z0-9-]*$/.test(doanCuoi), false);
  });
});
