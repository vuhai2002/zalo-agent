import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let accounts: typeof import("./account-store.js");
let agents: typeof import("./agent-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  accounts = await import("./account-store.js");
  agents = await import("./agent-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("agent-store", () => {
  it("ensureDefaultAgent tạo 1 lần, gọi lại trả cùng agent", () => {
    const a = agents.ensureDefaultAgent();
    const b = agents.ensureDefaultAgent();
    assert.equal(a.id, b.id);
    assert.equal(a.isDefault, true);
  });

  it("CRUD agent: tạo, sửa persona + model override, đọc lại đúng", () => {
    agents.createAgent({ id: "tu-van", name: "Tư Vấn", icon: "💼", persona: "Bạn là tư vấn viên" });

    const updated = agents.updateAgent("tu-van", {
      persona: "Bạn là tư vấn viên khóa học",
      modelProvider: "anthropic",
      modelName: "claude-sonnet-5",
      maxSteps: 4,
    });
    assert.equal(updated?.persona, "Bạn là tư vấn viên khóa học");
    assert.equal(updated?.modelProvider, "anthropic");
    assert.equal(updated?.maxSteps, 4);
  });

  it("không xóa được agent mặc định hoặc agent đang được dùng", () => {
    const def = agents.ensureDefaultAgent();
    assert.equal(agents.deleteAgent(def.id).ok, false);

    accounts.createAccount({ id: "acc-dung-agent", label: "A", agentId: "tu-van" });
    const result = agents.deleteAgent("tu-van");
    assert.equal(result.ok, false);
    assert.match(result.reason!, /account dùng/);
  });

  it("xóa được agent không ai dùng", () => {
    agents.createAgent({ id: "agent-le", name: "Lẻ" });
    assert.equal(agents.deleteAgent("agent-le").ok, true);
    assert.equal(agents.getAgent("agent-le"), null);
  });

  it("getAgentForAccount rơi về default khi agent không tồn tại", () => {
    const agent = agents.getAgentForAccount("agent-da-xoa");
    assert.equal(agent.isDefault, true);
  });
});

describe("account-store", () => {
  it("tạo account không chỉ định agent thì gắn agent mặc định", () => {
    const acc = accounts.createAccount({ id: "acc-moi", label: "Nick test" });
    assert.equal(acc.agentId, agents.ensureDefaultAgent().id);
    assert.equal(acc.enabled, true);
    assert.equal(acc.groupPassiveListen, true);
  });

  it("đổi tên + policies + gắn não khác", () => {
    const updated = accounts.updateAccount("acc-moi", {
      label: "Nick đã đổi tên",
      agentId: "tu-van",
      allowlist: { mode: "list", userIds: ["u1", "u2"] },
      groupRequireMention: false,
    });
    assert.equal(updated?.label, "Nick đã đổi tên");
    assert.equal(updated?.agentId, "tu-van");
    assert.deepEqual(updated?.allowlist, { mode: "list", userIds: ["u1", "u2"] });
    assert.equal(updated?.groupRequireMention, false);
  });

  it("listEnabledAccounts lọc account tắt", () => {
    accounts.updateAccount("acc-moi", { enabled: false });
    assert.ok(!accounts.listEnabledAccounts().some((a) => a.id === "acc-moi"));
    assert.ok(accounts.listAccounts().some((a) => a.id === "acc-moi"));
  });

  it("xóa account", () => {
    assert.equal(accounts.deleteAccount("acc-moi"), true);
    assert.equal(accounts.deleteAccount("acc-moi"), false);
  });
});

describe("seed migration từ accounts.json", () => {
  const seedPath = () => {
    const p = path.join(dataDir, "seed-accounts.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        accounts: [
          { id: "acc-persona", label: "Có persona", persona: "Bạn là Minh Triết" },
          { id: "acc-trong", label: "Không persona" },
        ],
      }),
    );
    return p;
  };

  it("import account cũ: persona riêng tách thành agent riêng, rỗng dùng default", () => {
    // Dọn dữ liệu các test trên để bảng accounts trống - điều kiện chạy seed
    database.db.exec("DELETE FROM accounts");

    accounts.runAccountsSeedMigration(seedPath());

    const coPersona = accounts.getAccount("acc-persona")!;
    assert.equal(coPersona.agentId, "acc-persona-agent");
    const rieng = agents.getAgent("acc-persona-agent")!;
    assert.equal(rieng.persona, "Bạn là Minh Triết");
    assert.equal(rieng.name, "Não của Có persona");

    const khongPersona = accounts.getAccount("acc-trong")!;
    assert.equal(khongPersona.agentId, agents.ensureDefaultAgent().id);
  });

  it("bảng accounts đã có dữ liệu thì seed là no-op", () => {
    const before = accounts.listAccounts().length;
    accounts.runAccountsSeedMigration(seedPath());
    assert.equal(accounts.listAccounts().length, before);
  });
});
