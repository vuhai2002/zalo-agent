import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * `quetMotLuot` là hàm thuần (mọi phụ thuộc tiêm vào). Vẫn `setupTestEnv` trước
 * vì import module kéo theo database.ts (mở DB ở module scope).
 */
let dataDir: string;
let sweep: typeof import("./friend-auto-accept-sweep.js");
let database: typeof import("../conversation/database.js");

const apiGia = { id: "api" } as unknown as API;

before(async () => {
  dataDir = setupTestEnv();
  sweep = await import("./friend-auto-accept-sweep.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

type Deps = import("./friend-auto-accept-sweep.js").QuetDeps;

/** Dựng deps ghi lại mọi lời gọi để khẳng định */
function dungDeps(over: Partial<Deps> = {}): {
  deps: Deps;
  accepted: string[];
  xoaed: string[];
  mocGoi: number[];
} {
  const accepted: string[] = [];
  const xoaed: string[] = [];
  const mocGoi: number[] = [];
  const deps: Deps = {
    dsAccount: () => [{ id: "acc-1", api: apiGia }],
    getConfig: () => ({ autoAcceptFriends: true, autoAcceptFriendDelayMinutes: 2 }),
    layQuaHan: (_id, moc) => {
      mocGoi.push(moc);
      return [{ fromUid: "u1" }];
    },
    xoa: (_id, uid) => void xoaed.push(uid),
    accept: async (_api, uid) => void accepted.push(uid),
    ...over,
  };
  return { deps, accepted, xoaed, mocGoi };
}

describe("quetMotLuot", () => {
  it("account BẬT auto + dòng quá hạn -> accept + xóa; mốc = now - delay*60000", async () => {
    const t = dungDeps();
    await sweep.quetMotLuot(1_000_000, t.deps);
    assert.deepEqual(t.accepted, ["u1"]);
    assert.deepEqual(t.xoaed, ["u1"]);
    assert.deepEqual(t.mocGoi, [1_000_000 - 2 * 60_000], "delay 2 phút -> mốc lùi 120000ms");
  });

  it("account TẮT auto -> KHÔNG hỏi pending, KHÔNG accept", async () => {
    const t = dungDeps({ getConfig: () => ({ autoAcceptFriends: false, autoAcceptFriendDelayMinutes: 2 }) });
    await sweep.quetMotLuot(1_000_000, t.deps);
    assert.deepEqual(t.mocGoi, [], "tắt thì không được gọi layQuaHan");
    assert.deepEqual(t.accepted, []);
  });

  it("một dòng accept NÉM -> dòng sau vẫn accept, dòng lỗi KHÔNG bị xóa", async () => {
    const t = dungDeps({
      layQuaHan: () => [{ fromUid: "u-loi" }, { fromUid: "u-ok" }],
      accept: async (_api, uid) => {
        if (uid === "u-loi") throw new Error("Zalo từ chối");
      },
    });
    await sweep.quetMotLuot(1_000_000, t.deps);
    assert.deepEqual(t.xoaed, ["u-ok"], "chỉ xóa dòng accept THÀNH CÔNG; dòng lỗi giữ lại để thử lượt sau");
  });

  it("nhiều account một lượt: chỉ account BẬT + có api mới accept (isolation)", async () => {
    const accepted: string[] = [];
    const deps: Deps = {
      dsAccount: () => [
        { id: "on", api: apiGia },
        { id: "off", api: apiGia },
        { id: "bot", api: null },
      ],
      getConfig: (id) => ({
        autoAcceptFriends: id !== "off",
        autoAcceptFriendDelayMinutes: 2,
      }),
      layQuaHan: (id) => [{ fromUid: `u-${id}` }],
      xoa: () => {},
      accept: async (_api, uid) => void accepted.push(uid),
    };
    await sweep.quetMotLuot(1_000_000, deps);
    assert.deepEqual(accepted, ["u-on"], "off (tắt) và bot (api null) đều bị bỏ; chỉ on được accept");
  });

  it("api null (kênh bot / chưa chạy) -> bỏ qua, không hỏi config/accept", async () => {
    let goiConfig = 0;
    const t = dungDeps({
      dsAccount: () => [{ id: "acc-bot", api: null }],
      getConfig: () => {
        goiConfig++;
        return { autoAcceptFriends: true, autoAcceptFriendDelayMinutes: 2 };
      },
    });
    await sweep.quetMotLuot(1_000_000, t.deps);
    assert.equal(goiConfig, 0, "api null thì bỏ trước cả khi đọc config");
    assert.deepEqual(t.accepted, []);
  });
});
