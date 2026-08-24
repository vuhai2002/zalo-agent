import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";

import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * Route /api/friends. Dùng store THẬT (setupTestEnv) + `getApi` giả (khỏi cần
 * tài khoản chạy thật). Route paths tương đối (prefix /api/friends thêm lúc mount).
 */
let dataDir: string;
let mod: typeof import("./friend-routes.js");
let store: typeof import("../../conversation/friend-request-store.js");
let database: typeof import("../../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./friend-routes.js");
  store = await import("../../conversation/friend-request-store.js");
  database = await import("../../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let accepted: string[];
let rejected: string[];
let apiGia: API | null;
let getAllFriendsNem = false;

function fakeApi(): API {
  return {
    acceptFriendRequest: async (uid: string) => void accepted.push(uid),
    rejectFriendRequest: async (uid: string) => void rejected.push(uid),
    getAllFriends: async () => {
      if (getAllFriendsNem) throw new Error("rate limit");
      // Trả cả PII để test khẳng định server ĐÃ lược bỏ.
      return [{ userId: "f1", displayName: "F One", zaloName: "z1", phoneNumber: "0900", dob: "1990" }];
    },
  } as unknown as API;
}

function app() {
  return mod.createFriendRoutes({ getApi: () => apiGia });
}

const POST = (uid: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(uid === undefined ? {} : { fromUid: uid }),
});

beforeEach(() => {
  accepted = [];
  rejected = [];
  apiGia = fakeApi();
  getAllFriendsNem = false;
});

describe("friend-routes", () => {
  it("GET /:accountId/requests trả dòng đã seed trong DB", async () => {
    store.upsertFriendRequest({ accountId: "acc-r", fromUid: "u-seed", message: "hi", senderName: "Hoa", avatarUrl: null, receivedAt: 5 });
    const res = await app().request("/acc-r/requests");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { requests: { fromUid: string }[] };
    assert.ok(body.requests.some((r) => r.fromUid === "u-seed"));
  });

  it("POST accept -> gọi acceptFriendRequest + XÓA dòng khỏi DB", async () => {
    store.upsertFriendRequest({ accountId: "acc-a", fromUid: "u-acc", message: "", senderName: null, avatarUrl: null, receivedAt: 1 });
    const res = await app().request("/acc-a/accept", POST("u-acc"));
    assert.equal(res.status, 200);
    assert.deepEqual(accepted, ["u-acc"]);
    assert.ok(!store.listFriendRequests("acc-a").some((r) => r.fromUid === "u-acc"), "phải xóa dòng sau accept");
  });

  it("POST reject -> gọi rejectFriendRequest + XÓA dòng", async () => {
    store.upsertFriendRequest({ accountId: "acc-rj", fromUid: "u-rej", message: "", senderName: null, avatarUrl: null, receivedAt: 1 });
    const res = await app().request("/acc-rj/reject", POST("u-rej"));
    assert.equal(res.status, 200);
    assert.deepEqual(rejected, ["u-rej"]);
    assert.ok(!store.listFriendRequests("acc-rj").some((r) => r.fromUid === "u-rej"));
  });

  it("api null (bot/chưa chạy) -> accept trả 409, KHÔNG xóa dòng", async () => {
    store.upsertFriendRequest({ accountId: "acc-x", fromUid: "u-x", message: "", senderName: null, avatarUrl: null, receivedAt: 1 });
    apiGia = null;
    const res = await app().request("/acc-x/accept", POST("u-x"));
    assert.equal(res.status, 409);
    assert.ok(store.listFriendRequests("acc-x").some((r) => r.fromUid === "u-x"), "409 thì giữ dòng");
  });

  it("accept thiếu fromUid -> 400", async () => {
    const res = await app().request("/acc-a/accept", POST(undefined));
    assert.equal(res.status, 400);
  });

  it("acceptFriendRequest NÉM -> 502, KHÔNG xóa dòng", async () => {
    store.upsertFriendRequest({ accountId: "acc-e", fromUid: "u-e", message: "", senderName: null, avatarUrl: null, receivedAt: 1 });
    apiGia = { acceptFriendRequest: async () => { throw new Error("Zalo từ chối"); } } as unknown as API;
    const res = await app().request("/acc-e/accept", POST("u-e"));
    assert.equal(res.status, 502);
    assert.ok(store.listFriendRequests("acc-e").some((r) => r.fromUid === "u-e"), "accept hỏng thì giữ dòng");
  });

  it("GET list -> getAllFriends; api null -> 409; getAllFriends ném -> 502", async () => {
    const ok = await app().request("/acc-a/list");
    assert.equal(ok.status, 200);
    // Chỉ userId/displayName/zaloName - phoneNumber/dob PHẢI bị lược bỏ.
    assert.deepEqual((await ok.json()) as { friends: unknown[] }, {
      friends: [{ userId: "f1", displayName: "F One", zaloName: "z1" }],
    });

    apiGia = null;
    assert.equal((await app().request("/acc-a/list")).status, 409);

    apiGia = fakeApi();
    getAllFriendsNem = true;
    assert.equal((await app().request("/acc-a/list")).status, 502);
  });
});
