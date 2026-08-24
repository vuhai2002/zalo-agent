# Tab "Bạn bè" - Implementation Plan

> **For agentic workers:** thực thi từng Task một, mỗi Task test-first (TDD) + phá-kiểm + commit riêng. Steps dùng checkbox `- [ ]`.

**Goal:** Thêm tab "Bạn bè" trên dashboard: xem/accept/reject yêu cầu kết bạn, xem danh sách bạn, xử lý sự kiện friend realtime, tùy chọn auto-accept per-account.

**Architecture:** Request đến bắt qua listener `friend_event` -> lưu bảng DB `friend_requests` (Zalo không có API list request đến). Manual accept/reject qua route dashboard; auto-accept qua vòng quét toàn cục trên bảng pending theo delay per-account. Danh sách bạn lấy trực tiếp `getAllFriends()`. Chỉ kênh cá nhân.

**Tech Stack:** node:sqlite (DatabaseSync), Hono (dashboard API), React + Vite (web), zca-js (`api.acceptFriendRequest`/`rejectFriendRequest`/`getAllFriends`/`getUserInfo`, listener `friend_event`).

**Spec:** `plans/260825-0125-tab-ban-be/plan.md`

## Global Constraints

- Chỉ kênh CÁ NHÂN. Kênh bot `api === null` -> route 409, tab ẩn/khóa account bot.
- File < 200 dòng, kebab-case, tách module. Chuỗi tiếng Việt giữ dấu, dấu câu ASCII.
- Test: `setupTestEnv()` TRƯỚC khi `await import()` module chạm DB. Sửa file nào chạy đúng file test đó; full suite chỉ chạy 1 lần ở cuối.
- Không thêm env var (config nằm per-account trong DB). Mỗi Task phá-kiểm rồi mới commit.
- Chuỗi tự do của người lạ (`message`, `sender_name`) chỉ HIỂN THỊ (React escape), KHÔNG vào prompt model.
- Không auto commit/push toàn cục - CHỈ commit theo Task khi được phép (như các phiên trước); push hỏi ở cuối.

---

### Task 1: DB schema + friend-request-store

**Files:**
- Create: `src/conversation/friend-schema.ts`
- Create: `src/conversation/friend-request-store.ts`
- Create: `src/conversation/friend-request-store.test.ts`
- Modify: `src/conversation/database.ts` (gọi `taoBangFriendRequests(db)` trong `runMigrations`, cạnh `taoBangKnowledgeBase`)

**Interfaces produced:**
- `taoBangFriendRequests(db: DatabaseSync): void`
- `type FriendRequestRow = { accountId: string; fromUid: string; message: string; senderName: string | null; avatarUrl: string | null; receivedAt: number }`
- `upsertFriendRequest(row: FriendRequestRow): void` - PK `(account_id, from_uid)`, ON CONFLICT update message/sender_name/avatar_url/received_at.
- `xoaFriendRequest(accountId: string, fromUid: string): void`
- `listFriendRequests(accountId: string): FriendRequestRow[]` - ORDER BY received_at DESC.
- `layFriendRequestQuaHan(accountId: string, truocMoc: number): FriendRequestRow[]` - WHERE account_id=? AND received_at <= ?.

**Schema (SQL):**
```sql
CREATE TABLE IF NOT EXISTS friend_requests (
  account_id  TEXT NOT NULL,
  from_uid    TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  sender_name TEXT,
  avatar_url  TEXT,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, from_uid)
);
```

- [ ] **Step 1: Viết test thất bại** `friend-request-store.test.ts` - các ca:
  - upsert 1 dòng rồi list -> 1 dòng đúng field.
  - upsert lại cùng `(accountId, fromUid)` với message khác -> vẫn 1 dòng, message cập nhật (không đẻ dòng 2).
  - `xoaFriendRequest` -> list rỗng.
  - list lọc đúng theo accountId (2 account không lẫn).
  - `layFriendRequestQuaHan(acc, moc)`: dòng `received_at <= moc` trả về, dòng mới hơn thì không.
  (Nhớ `setupTestEnv()` rồi mới `await import`.)
- [ ] **Step 2: Chạy test -> FAIL** (`npx tsx --test src/conversation/friend-request-store.test.ts`).
- [ ] **Step 3: Viết `friend-schema.ts` + `friend-request-store.ts`** (prepared statements module-level như `contact-store.ts`) + gọi `taoBangFriendRequests` trong `database.ts`.
- [ ] **Step 4: Chạy test -> PASS** + `pnpm typecheck`.
- [ ] **Step 5: Phá-kiểm** - đổi `<=` thành `<` trong `layFriendRequestQuaHan` -> ca quá-hạn phải đỏ; hoàn nguyên.
- [ ] **Step 6: Commit** `feat(friend): bảng friend_requests + store`.

---

### Task 2: Config per-account (auto-accept toggle + delay)

**Files:**
- Modify: `src/conversation/database.ts` (`addColumnIfMissing("accounts", "auto_accept_friends", "INTEGER NOT NULL DEFAULT 0")`, `addColumnIfMissing("accounts", "auto_accept_friend_delay_minutes", "INTEGER NOT NULL DEFAULT 1")`)
- Modify: `src/config/account-store.ts` (`AccountConfig` + `toConfig` + cột SELECT + `updateAccount`)
- Modify: `src/server/routes/account-routes.ts` (`patchSchema`)
- Modify: `src/config/account-store.test.ts` (hoặc tạo nếu chưa có ca liên quan)

**Interfaces produced:**
- `AccountConfig.autoAcceptFriends: boolean` (mặc định `false`)
- `AccountConfig.autoAcceptFriendDelayMinutes: number` (mặc định `1`, min 0, max 1440)

- [ ] **Step 1: Viết test thất bại** (account-store): account mới có `autoAcceptFriends === false`, `autoAcceptFriendDelayMinutes === 1`; `updateAccount(id, { autoAcceptFriends: true, autoAcceptFriendDelayMinutes: 5 })` rồi `getAccount` trả đúng.
- [ ] **Step 2: Chạy -> FAIL.**
- [ ] **Step 3: Thêm 2 cột (database.ts) + map trong account-store (`toConfig` đọc `row.auto_accept_friends === 1`, `updateAccount` ghi `? 1 : 0`), thêm vào SELECT.**
- [ ] **Step 4: Thêm vào `patchSchema`** (`account-routes.ts`): `autoAcceptFriends: z.boolean().optional()`, `autoAcceptFriendDelayMinutes: z.number().int().min(0).max(1440).optional()`.
- [ ] **Step 5: Chạy test + typecheck -> PASS.**
- [ ] **Step 6: Phá-kiểm** - đổi default cột delay thành 0 -> test default đỏ; hoàn nguyên.
- [ ] **Step 7: Commit** `feat(friend): config auto-accept per-account`.

---

### Task 3: friend_event handler + wiring listener

**Files:**
- Create: `src/zalo/friend-event-handler.ts`
- Create: `src/zalo/friend-event-handler.test.ts`
- Modify: `src/zalo/zalo-listener.ts` (`startListener` thêm tham số `onFriendEvent?: (ev: FriendEvent) => void`, đăng ký `api.listener.on("friend_event", onFriendEvent)` cạnh `on("message")`)
- Modify: `src/zalo/account-manager.ts` (trong `attachAccount`, truyền `onFriendEvent = (ev) => handleFriendEvent(config.id, api, ev)`)

**Interfaces consumed:** store Task 1. **Produced:**
- `handleFriendEvent(accountId: string, api: API, event: FriendEvent, deps?: { layUser?: typeof api.getUserInfo }): Promise<void>` - deps để test tiêm getUserInfo giả.

**Logic:**
- `event.type === FriendEventType.REQUEST && !event.isSelf`: enrich `getUserInfo(fromUid)` (try/catch -> senderName/avatar null nếu hỏng) -> `upsertFriendRequest`.
- `ADD | REJECT_REQUEST | UNDO_REQUEST`: `xoaFriendRequest(accountId, uid)` (uid lấy đúng field theo type: REQUEST/REJECT/UNDO có `fromUid`; ADD `data` là threadId string = uid).
- `REMOVE` + khác: log debug, no-op.
- Toàn bộ bọc try/catch, KHÔNG ném.

- [ ] **Step 1: Viết test thất bại** (`friend-event-handler.test.ts`), dùng store thật + `getUserInfo` giả:
  - REQUEST !isSelf + getUserInfo trả tên/avatar -> upsert 1 dòng có senderName.
  - REQUEST !isSelf + getUserInfo NÉM -> vẫn upsert, senderName null (không ném).
  - REQUEST isSelf -> KHÔNG upsert.
  - ADD (uid đang pending) -> xóa dòng.
  - REJECT_REQUEST / UNDO_REQUEST -> xóa dòng.
  - REMOVE -> không đụng bảng, không ném.
- [ ] **Step 2: Chạy -> FAIL.**
- [ ] **Step 3: Viết `friend-event-handler.ts`.**
- [ ] **Step 4: Wire `zalo-listener.ts` + `account-manager.ts`** (chỉ kênh cá nhân - attachAccount vốn chỉ cho cá nhân).
- [ ] **Step 5: Chạy test + typecheck. Cả `zalo-listener.test.ts` nếu có canh chữ ký `startListener`.**
- [ ] **Step 6: Phá-kiểm** - bỏ nhánh xóa ở ADD -> ca ADD đỏ; đổi `!isSelf` thành bỏ điều kiện -> ca isSelf đỏ; hoàn nguyên.
- [ ] **Step 7: Commit** `feat(friend): handler friend_event lưu/xóa pending`.

---

### Task 4: Vòng quét auto-accept

**Files:**
- Create: `src/zalo/friend-auto-accept-sweep.ts`
- Create: `src/zalo/friend-auto-accept-sweep.test.ts`
- Modify: nơi boot runtime (vd `src/index.ts` hoặc `account-manager.ts`) để `startFriendAutoAcceptSweep(...)` chạy 1 lần.

**Interfaces consumed:** `layFriendRequestQuaHan`, `xoaFriendRequest` (Task 1), `getRunningAccounts`/`getRunningAccountKenh` (account-manager), `getAccount` (account-store). **Produced:**
- `quetMotLuot(now: number, deps): Promise<void>` - hàm THUẦN test được (tiêm danh sách account đang chạy + getAccount + api-getter + now).
- `startFriendAutoAcceptSweep(): () => void` - dựng `setInterval` (hằng `SWEEP_MS = 30_000`) gọi `quetMotLuot(Date.now(), depThat)`; trả `stop()`.

**Logic `quetMotLuot`:** với mỗi account cá nhân đang chạy có `autoAcceptFriends` bật: `moc = now - delayMinutes*60000`; `layFriendRequestQuaHan(id, moc)`; mỗi dòng `api.acceptFriendRequest(fromUid)` (try/catch từng dòng) -> `xoaFriendRequest`. `api` null/undefined -> bỏ account.

- [ ] **Step 1: Viết test thất bại** (`quetMotLuot` với deps giả):
  - account bật auto + có dòng quá delay -> gọi `acceptFriendRequest(uid)` + xóa dòng.
  - account bật auto + dòng CHƯA quá delay -> không accept.
  - account TẮT auto -> không accept dù có dòng quá hạn.
  - 2 dòng, dòng đầu `acceptFriendRequest` NÉM -> dòng 2 vẫn được accept (một lỗi không chặn cả lượt).
  - account `api` null (bot) -> bỏ qua, không ném.
- [ ] **Step 2: Chạy -> FAIL.**
- [ ] **Step 3: Viết `friend-auto-accept-sweep.ts` + boot sweep.**
- [ ] **Step 4: Chạy test + typecheck -> PASS.**
- [ ] **Step 5: Phá-kiểm** - bỏ `try/catch` từng dòng -> ca "một lỗi không chặn" đỏ; đổi `<= moc` -> ca chưa-quá-delay đỏ; hoàn nguyên.
- [ ] **Step 6: Commit** `feat(friend): vòng quét auto-accept theo delay`.

---

### Task 5: Backend API `/api/friends`

**Files:**
- Create: `src/server/routes/friend-routes.ts`
- Create: `src/server/routes/friend-routes.test.ts`
- Modify: `src/server/dashboard-server.ts` (import + `app.route("/api/friends", friendRoutes)`)

**Interfaces consumed:** store (Task 1), `getRunningAccountKenh` (account-manager). **Endpoints:**
- `GET /:accountId/requests` -> `{ requests: FriendRequestRow[] }` (từ DB, không cần api).
- `GET /:accountId/list` -> `{ friends: {...} }` (`api.getAllFriends()`, try/catch; 409 nếu `!api`).
- `POST /:accountId/accept` body `{ fromUid: string }` (zod) -> `api.acceptFriendRequest(fromUid)` + `xoaFriendRequest`; 409 nếu `!api`.
- `POST /:accountId/reject` body `{ fromUid: string }` -> `api.rejectFriendRequest(fromUid)` + `xoaFriendRequest`.

Route lấy `api` qua `getRunningAccountKenh(accountId)?.api`; test tiêm được (route factory nhận deps, hoặc mock module). Mọi nhánh lỗi bọc, không rò lỗi bên thứ ba.

- [ ] **Step 1: Viết test thất bại** (Hono `app.request(...)` + deps giả cho `getRunningAccountKenh` + store thật):
  - GET requests trả dòng đã seed trong DB.
  - POST accept gọi `acceptFriendRequest(fromUid)` + xóa dòng khỏi DB.
  - POST reject gọi `rejectFriendRequest` + xóa dòng.
  - `!api` (bot/chưa chạy) -> accept trả 409, KHÔNG xóa dòng.
  - POST accept thiếu `fromUid` -> 400 (zod).
  - GET list gọi `getAllFriends`; `!api` -> 409.
- [ ] **Step 2: Chạy -> FAIL.**
- [ ] **Step 3: Viết `friend-routes.ts` + mount.**
- [ ] **Step 4: Chạy test + typecheck -> PASS.**
- [ ] **Step 5: Phá-kiểm** - bỏ `xoaFriendRequest` sau accept -> ca "xóa dòng" đỏ; bỏ guard `!api` -> ca 409 đỏ; hoàn nguyên.
- [ ] **Step 6: Commit** `feat(friend): API /api/friends (requests/list/accept/reject)`.

---

### Task 6: Frontend - tab Bạn bè + config UI

**Files:**
- Create: `web/src/pages/friends-page.tsx`
- Modify: `web/src/app.tsx` (`<Route path="/friends" element={<FriendsPage accounts={accounts} />} />` + import)
- Modify: `web/src/layout/sidebar-nav.tsx` (item `{ to: "/friends", label: "Bạn bè", icon: ... }` nhóm "Hội thoại")
- Modify: `web/src/dashboard-api-client.ts` (types `FriendRequestItem`/`FriendItem` + methods `friendRequests(accountId)`, `friendList(accountId)`, `acceptFriend(accountId, fromUid)`, `rejectFriend(accountId, fromUid)`)
- Modify: `web/src/pages/account-edit-drawer.tsx` (toggle `autoAcceptFriends` + ô số `autoAcceptFriendDelayMinutes`, gửi trong PATCH)

**UI:**
- `AccountFilter` chỉ account cá nhân (lọc `loai !== "bot"`).
- Mục "Chờ duyệt": bảng avatar/tên/lời nhắn/nhận-lúc + nút Accept, Reject (Reject qua `useConfirmDialog`). `setInterval(reload, 7000)` (chỉ đọc DB).
- Mục "Danh sách bạn": bảng chỉ xem, lấy khi mở + nút Làm mới (KHÔNG poll).
- Dòng ghi chú: "Chỉ hiện yêu cầu tới từ khi bật tính năng; không lấy lại được yêu cầu cũ."

- [ ] **Step 1: api-client** thêm types + 4 methods (theo mẫu `contacts`/`xoaContact`).
- [ ] **Step 2: `friends-page.tsx`** theo pattern `contacts-page.tsx` (state, reload, poll pending, nút accept/reject gọi api rồi reload).
- [ ] **Step 3: Route + nav item + import.**
- [ ] **Step 4: `account-edit-drawer.tsx`** thêm toggle + ô delay (min 0 max 1440), nối form state + PATCH.
- [ ] **Step 5: `pnpm typecheck` + build web** (`pnpm --filter web build` hoặc lệnh build web của repo) -> PASS. Nếu có test frontend cho helper thuần (lọc account bot) thì thêm 1 ca.
- [ ] **Step 6: Commit** `feat(friend): tab Bạn bè + config UI trên dashboard`.

---

### Task 7: Tổng kiểm + docs

- [ ] **Step 1:** `pnpm typecheck` sạch.
- [ ] **Step 2:** Full suite `pnpm test` MỘT LẦN -> xanh.
- [ ] **Step 3:** Cập nhật `docs/project-roadmap.md` (mục version mới) + dòng quyết định `CLAUDE.md` (tab Bạn bè: bảng pending bắt buộc vì không có API list request đến; chỉ kênh cá nhân; sweep toàn cục restart-safe).
- [ ] **Step 4:** Cập nhật `plans/260825-0125-tab-ban-be/plan.md` trạng thái XONG.
- [ ] **Step 5: Commit** `docs: ghi tab Bạn bè vào roadmap + CLAUDE.md`.

## Self-review (đã rà)

- Spec coverage: DB(T1), config(T2), listener/handler(T3), sweep(T4), API(T5), frontend+config-UI(T6), docs+full-suite(T7). Đủ mọi mục spec.
- Type consistency: `FriendRequestRow`, tên hàm store, `handleFriendEvent`, `quetMotLuot` nhất quán giữa các Task.
- Không placeholder: mỗi Task có file cụ thể, ca test cụ thể, phá-kiểm cụ thể, commit.
- Enrich/allowlist/backfill/bot-exclusion khớp spec.

## Ghi chú thứ tự

T1 (nền, không phụ thuộc) -> T2 (config, độc lập) -> T3 (dùng store T1) -> T4 (dùng store T1 + config T2) -> T5 (dùng store T1) -> T6 (dùng API T5 + config T2) -> T7. T2 có thể làm song song T1 nhưng thứ tự trên là an toàn.
