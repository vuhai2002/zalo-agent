import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * API `/api/tools` - tập trung vào `kb_search.available` vì đây là tool DUY
 * NHẤT gate theo AGENT (mọi tool khác trước đó gate theo hạ tầng toàn cục,
 * không phụ thuộc `agentId`). Route đã đổi để nhận `?agentId=` optional - xem
 * `dungScope()` ở tool-routes.ts cho lý do đầy đủ.
 */

let dataDir: string;
let app: Hono;
let sessionCookie: string;
let agentStore: typeof import("../../config/agent-store.js");
let kbSourceStore: typeof import("../../knowledge/kb-source-store.js");
let kbChunkStore: typeof import("../../knowledge/kb-chunk-store.js");
let kbBinding: typeof import("../../knowledge/kb-agent-binding.js");
let database: typeof import("../../conversation/database.js");

const PASSWORD = "mat-khau-tool-routes-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  agentStore = await import("../../config/agent-store.js");
  kbSourceStore = await import("../../knowledge/kb-source-store.js");
  kbChunkStore = await import("../../knowledge/kb-chunk-store.js");
  kbBinding = await import("../../knowledge/kb-agent-binding.js");
  database = await import("../../conversation/database.js");

  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources", "agents"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
});

const authed = (path: string) => app.request(path, { headers: { cookie: sessionCookie } });

type ToolItem = { key: string; available: boolean; unavailableHint?: string };

async function layToolItems(query = ""): Promise<{ status: number; items?: ToolItem[] }> {
  const res = await authed(`/api/tools${query}`);
  if (res.status !== 200) return { status: res.status };
  const body = (await res.json()) as { items: ToolItem[] };
  return { status: res.status, items: body.items };
}

function kbSearchCua(items: ToolItem[] | undefined): ToolItem {
  const item = items?.find((t) => t.key === "kb_search");
  assert.ok(item, "kb_search phải có mặt trong catalog (route trả CẢ tool chưa available)");
  return item;
}

/** Nạp 1 nguồn kèm 1 đoạn, gán cho agent (bỏ qua nếu `agentId` là undefined) */
function napNguon(agentId?: string): { id: string } {
  const nguon = kbSourceStore.taoNguon({ ten: "Nguồn test", loai: "text", noiDungGoc: "Nội dung test." });
  kbChunkStore.luuDoan(nguon.id, [{ thuTu: 0, tieuDe: "", noiDung: "Nội dung test." }]);
  if (agentId) kbBinding.datNguonChoAgent(agentId, [nguon.id]);
  return nguon;
}

describe("GET /api/tools - kb_search.available theo agentId", () => {
  it("agentId của agent ĐÃ gán nguồn -> available: true", async () => {
    const agent = agentStore.createAgent({ id: "agent-co-nguon", name: "Agent có nguồn" });
    napNguon(agent.id);

    const { items } = await layToolItems(`?agentId=${agent.id}`);
    assert.equal(kbSearchCua(items).available, true);
  });

  it("agentId của agent CHƯA gán nguồn -> available: false", async () => {
    const agent = agentStore.createAgent({ id: "agent-chua-gan", name: "Agent chưa gán" });
    napNguon(); // nguồn tồn tại trong kho, nhưng KHÔNG gán cho agent này

    const { items } = await layToolItems(`?agentId=${agent.id}`);
    assert.equal(kbSearchCua(items).available, false);
  });

  it("không truyền agentId, kho RỖNG -> available: false", async () => {
    const { items } = await layToolItems();
    assert.equal(kbSearchCua(items).available, false);
  });

  it("không truyền agentId, kho CÓ nguồn (bất kể gán cho ai) -> available: true", async () => {
    const agent = agentStore.createAgent({ id: "agent-khac", name: "Agent khác" });
    napNguon(agent.id);

    const { items } = await layToolItems();
    assert.equal(kbSearchCua(items).available, true);
  });

  it("agentId trỏ vào agent KHÔNG TỒN TẠI -> 400, không phải 500 hay rơi về ca không-agent", async () => {
    const { status } = await layToolItems("?agentId=khong-ton-tai");
    assert.equal(status, 400);
  });
});

describe("GET /api/tools - loại kênh của account", () => {
  it("account BOT: tool cần zca-js hiện KHÔNG dùng được, kèm lý do của Zalo", async () => {
    // Thiếu đường này thì trang Tools chọn một tài khoản bot xong vẫn hiện đủ
    // 14 tool và "Gửi file" vẫn xanh - trong khi model chạy trên tài khoản đó
    // không hề nhận được nó. Dashboard nói một đằng, model nhận một nẻo.
    const accStore = await import("../../config/account-store.js");
    accStore.createAccount({ id: "acc-bot", label: "Bot" });
    accStore.datLoaiKenh("acc-bot", "bot");

    const { items } = await layToolItems("?accountId=acc-bot");
    const sendFile = items?.find((t) => t.key === "send_file");
    assert.equal(sendFile?.available, false, "send_file vẫn hiện dùng được trên tài khoản bot");
    assert.match(sendFile?.unavailableHint ?? "", /Zalo Bot API/);
  });

  it("account CÁ NHÂN: đúng những tool đó vẫn dùng được", async () => {
    const accStore = await import("../../config/account-store.js");
    accStore.createAccount({ id: "acc-ca-nhan", label: "Cá nhân" });

    const { items } = await layToolItems("?accountId=acc-ca-nhan");
    assert.equal(items?.find((t) => t.key === "send_file")?.available, true);
  });

  it("KHÔNG truyền accountId thì rơi về kênh cá nhân, không vỡ", async () => {
    const { status, items } = await layToolItems();
    assert.equal(status, 200);
    assert.equal(items?.find((t) => t.key === "send_file")?.available, true);
  });

  it("accountId không tồn tại thì 400, KHÔNG im lặng rơi về kênh cá nhân", async () => {
    // Bản đầu để rơi về "ca_nhan" với lý lẽ "account sai không nên làm chết cả
    // trang Tools". Nhưng nhánh `agentId` ngay cạnh trả 400 vì ĐÚNG lý lẽ ngược
    // lại, và lý lẽ đó thắng: im lặng đổi một id sai thành "kênh cá nhân" làm
    // trang Tools hiện đủ 14 tool "dùng được" cho một tài khoản BOT vừa bị xóa.
    // Đó là gài bẫy cho lần debug sau, đúng thứ cờ `available` sinh ra để chặn.
    const { status } = await layToolItems("?accountId=khong-ton-tai");
    assert.equal(status, 400);
  });
});
