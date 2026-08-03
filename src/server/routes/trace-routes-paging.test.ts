import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * Phân trang trang Trace.
 *
 * `database.ts` mở SQLite ở MODULE SCOPE, nên phải `setupTestEnv()` xong mới
 * `await import()` - import tĩnh sẽ mở nhầm DB thật (bẫy ghi trong CLAUDE.md).
 */

setupTestEnv();

let traceRoutes: typeof import("./trace-routes.js").traceRoutes;
let store: typeof import("../../agent/agent-trace-store.js");
let database: typeof import("../../conversation/database.js");

/** Tổng số lượt dựng sẵn - đủ để lật nhiều trang với cỡ trang nhỏ */
const SO_LUOT = 12;

before(async () => {
  traceRoutes = (await import("./trace-routes.js")).traceRoutes;
  store = await import("../../agent/agent-trace-store.js");
  database = await import("../../conversation/database.js");

  database.db.exec("DELETE FROM agent_steps; DELETE FROM agent_turns;");
  const insTurn = database.db.prepare(
    "INSERT INTO agent_turns (account_id, thread_id, total_tokens, steps, created_at) VALUES (?,?,?,?,?)",
  );
  for (let i = 0; i < SO_LUOT; i++) {
    insTurn.run("acc", "th", 100, 1, `2026-07-0${(i % 9) + 1}T00:00:00.000Z`);
  }
  // Trace chỉ liệt kê lượt CÓ step (INNER JOIN) - phải ghi step cho mọi lượt
  for (const r of database.db.prepare("SELECT id FROM agent_turns").all() as { id: number }[]) {
    store.saveTurnTrace(r.id, [
      {
        stepNumber: 1,
        attempt: 1,
        text: "xong",
        reasoning: "",
        toolCalls: [],
        toolResults: [],
        toolErrors: [],
        finishReason: "stop",
        warnings: [],
        inputTokens: 10,
        outputTokens: 5,
      },
    ]);
  }
});

async function goi(duong: string) {
  const r = await traceRoutes.request(duong);
  return { status: r.status, body: (await r.json()) as { turns: { id: number }[]; nextCursor: number | null } };
}

/** Lật hết trang bằng con trỏ, trả danh sách id theo thứ tự đã đọc */
async function latHetTrang(duong: string, limit: number): Promise<number[]> {
  const ra: number[] = [];
  let cursor: number | null = null;
  for (let vong = 0; vong < 50; vong++) {
    const q = `${duong}?limit=${limit}${cursor === null ? "" : `&before=${cursor}`}`;
    const { body } = await goi(q);
    ra.push(...body.turns.map((t) => t.id));
    if (body.nextCursor === null) return ra;
    cursor = body.nextCursor;
  }
  throw new Error("lật quá 50 trang - con trỏ không tiến");
}

describe("phân trang trace", () => {
  for (const duong of ["/", "/acc/th"]) {
    it(`${duong}: lật từng trang ra đúng danh sách đọc một lần`, async () => {
      const motLan = (await goi(`${duong}?limit=50`)).body.turns.map((t) => t.id);
      assert.equal(motLan.length, SO_LUOT);
      for (const limit of [1, 3, 5, 11, 12]) {
        assert.deepEqual(await latHetTrang(duong, limit), motLan, `cỡ trang ${limit}`);
      }
    });

    it(`${duong}: mới nhất trước, nextCursor null ở trang cuối`, async () => {
      const t = (await goi(`${duong}?limit=50`)).body;
      assert.ok(t.turns[0]!.id > t.turns[t.turns.length - 1]!.id, "phải giảm dần theo id");
      assert.equal(t.nextCursor, null);

      const nua = (await goi(`${duong}?limit=5`)).body;
      assert.equal(nua.turns.length, 5);
      assert.equal(nua.nextCursor, nua.turns[4]!.id, "con trỏ phải là id lượt CUỐI trang");
    });

    it(`${duong}: trang VỪA KHÍT số lượt còn lại thì nextCursor phải null`, async () => {
      // Ca dễ sót: xin đúng bằng số lượt đang có. Nhầm `>` thành `>=` lúc kiểm
      // "còn nữa không" thì nút "Xem thêm" vẫn hiện, bấm vào ra trang rỗng.
      const vuaKhit = (await goi(`${duong}?limit=${SO_LUOT}`)).body;
      assert.equal(vuaKhit.turns.length, SO_LUOT);
      assert.equal(vuaKhit.nextCursor, null, "vừa hết mà vẫn báo còn");

      // Và ở giữa chừng: trang cuối lấy đúng số còn lại
      const nua = (await goi(`${duong}?limit=${SO_LUOT - 2}`)).body;
      assert.ok(nua.nextCursor !== null);
      const cuoi = (await goi(`${duong}?limit=2&before=${nua.nextCursor}`)).body;
      assert.equal(cuoi.turns.length, 2);
      assert.equal(cuoi.nextCursor, null, "hai lượt cuối mà vẫn báo còn");
    });

    it(`${duong}: con trỏ hỏng -> trang RỖNG, không rơi về trang đầu`, async () => {
      // Rơi về trang đầu là cách client nối thêm bản sao vô tận mà không ai thấy
      for (const rac of ["abc", "0", "-5", "1.5", "9e99", ""]) {
        const { body } = await goi(`${duong}?before=${encodeURIComponent(rac)}`);
        assert.deepEqual(body.turns, [], `before=${rac}`);
        assert.equal(body.nextCursor, null);
      }
    });

    it(`${duong}: con trỏ trỏ ra ngoài phạm vi thì trả rỗng, không lỗi`, async () => {
      const { status, body } = await goi(`${duong}?before=1`);
      assert.equal(status, 200);
      assert.deepEqual(body.turns, []);
      assert.equal(body.nextCursor, null);
    });
  }

  it("trần 50 lượt vẫn giữ dù client xin nhiều hơn", async () => {
    const { body } = await goi("/?limit=99999");
    assert.ok(body.turns.length <= 50);
  });
});
