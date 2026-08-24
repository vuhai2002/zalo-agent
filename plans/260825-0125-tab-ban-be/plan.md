# Spec: Tab "Bạn bè" (quản lý kết bạn trên dashboard)

- Ngày: 2026-08-25
- Trạng thái: XONG (2026-08-25) - 7 Task, full suite 2568/2568, review Opus backend+frontend đã áp
- Loại: subsystem mới (DB + listener + sweep + API + UI + config per-account)

## 1. Mục tiêu

Thêm một tab "Bạn bè" trên dashboard cho tài khoản Zalo CÁ NHÂN:

- Xem danh sách yêu cầu kết bạn ĐẾN đang chờ, có nút Accept / Reject.
- Xem danh sách bạn bè hiện có (chỉ xem).
- Xử lý sự kiện kết bạn realtime (REQUEST / ADD / REMOVE / REJECT / UNDO).
- Tùy chọn AUTO-ACCEPT per-account (mặc định TẮT); khi bật thì tự accept sau
  một khoảng trễ chỉnh được (mặc định 1 phút).

## 2. Ràng buộc cứng (định hình thiết kế)

1. **zca-js KHÔNG có API liệt kê "request kết bạn ĐẾN đang chờ".** Chỉ có
   `getAllFriends()` (bạn bè) và `getSentFriendRequest()` (request MÌNH gửi đi).
   Request người khác gửi ĐẾN chỉ tới qua sự kiện listener `friend_event` type
   `REQUEST`. => Phải LƯU request vào bảng DB mới ngay khi sự kiện tới.
2. **Không backfill được request cũ**: chỉ bắt được request tới SAU khi tính năng
   chạy + listener sống. Phải nói rõ điều này trên UI.
3. **Chỉ áp cho kênh CÁ NHÂN** (zca-js có `api.listener` + `friend_event`). Kênh
   Zalo Bot chính thức có `api = null`, không có khái niệm kết bạn -> tab ẩn/khóa
   account loại bot; route trả 409.
4. **Không có SSE/WebSocket** trong dashboard: cập nhật live bằng poll cục bộ
   (`setInterval`) như trang Knowledge.

## 3. Quyết định đã chốt (với người dùng)

- Danh sách bạn: LẤY TRỰC TIẾP `getAllFriends()` mỗi lần mở tab + nút Làm mới
  (KHÔNG cache DB).
- Auto-accept: toggle per-account, mặc định TẮT. Khi bật: accept qua VÒNG QUÉT
  định kỳ trên bảng pending, theo delay `autoAcceptFriendDelayMinutes` per-account,
  CHỈNH ĐƯỢC trên dashboard, mặc định 1 phút. KHÔNG dùng setTimeout trong bộ nhớ,
  KHÔNG dùng scheduler agent.
- Accept KHÔNG tự thêm vào allowlist (tách bạch kết bạn vs cho phép chat).
- Nút hành động: chỉ Accept + Reject cho request; danh sách bạn chỉ để xem (KHÔNG
  unfriend/block).
- Vòng quét = MỘT timer toàn cục (không per-account).
- Enrich tên/avatar cho request = ngay lúc nhận sự kiện (`getUserInfo`), hỏng thì
  lưu mỗi UID.

## 4. Kiến trúc theo thành phần

### 4.1. DB - bảng mới `friend_requests`

Module riêng `src/conversation/friend-schema.ts` export `taoBangFriendRequests(db)`,
gọi trong `runMigrations()` (pattern như KB `taoBangKnowledgeBase`). Không phình
`database.ts`.

Cột:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `account_id` | TEXT | tài khoản nhận request |
| `from_uid` | TEXT | UID người gửi request |
| `message` | TEXT | lời nhắn kèm request (có thể rỗng) |
| `sender_name` | TEXT | tên enrich từ getUserInfo (nullable) |
| `avatar_url` | TEXT | avatar enrich (nullable) |
| `received_at` | INTEGER | epoch ms lúc nhận sự kiện - dùng cho delay quét |

- PK `(account_id, from_uid)` -> upsert, một người gửi lại không đẻ dòng trùng.
- Danh sách BẠN không lưu (lấy trực tiếp).

Store: `src/conversation/friend-request-store.ts` (pattern như `contact-store.ts`,
prepared statements module-level):
- `upsertFriendRequest(row)` - chèn/cập nhật khi có REQUEST.
- `xoaFriendRequest(accountId, fromUid)` - xóa khi ADD/REJECT/UNDO/accept/reject.
- `listFriendRequests(accountId)` - cho route GET.
- `layFriendRequestQuaHan(accountId, truocMoc)` - cho vòng quét (received_at <= mốc).

### 4.2. Listener - handler `friend_event`

- Mở rộng `startListener(accountId, api, onMessage)` (`src/zalo/zalo-listener.ts`)
  thêm tham số callback `onFriendEvent?`, đăng ký `api.listener.on("friend_event")`
  cạnh `on("message")`.
- Wire ở `attachAccount` (`src/zalo/account-manager.ts`) - truyền handler mới. Chỉ
  kênh cá nhân (bot đi đường khác, `api = null`).
- Module `src/zalo/friend-event-handler.ts` export `handleFriendEvent(accountId, api, event)`:
  - `REQUEST` && `!isSelf`: `getUserInfo(fromUid)` enrich (bọc try/catch), rồi
    `upsertFriendRequest`. Ghi log.
  - `ADD` | `REJECT_REQUEST` | `UNDO_REQUEST`: `xoaFriendRequest(accountId, uid)`.
  - `REMOVE`: chỉ ghi log (danh sách bạn lấy trực tiếp nên tự cập nhật).
  - Các type khác: bỏ qua (log debug).
- Handler KHÔNG ném ra listener (bọc try/catch, lỗi chỉ log).

### 4.3. Vòng quét auto-accept

Module `src/zalo/friend-auto-accept-sweep.ts`:
- MỘT `setInterval` toàn cục (chu kỳ = hằng số, vd 30s; hoặc tham số tuning
  `FRIEND_AUTO_ACCEPT_SWEEP_SECONDS` nếu muốn chỉnh - xem 4.4), khởi động 1 lần khi
  app boot (cạnh nơi khởi động runtime).
- Mỗi nhịp: duyệt các account cá nhân ĐANG CHẠY; account nào `autoAcceptFriends`
  bật -> `layFriendRequestQuaHan(id, now - delayMinutes*60000)` -> với mỗi dòng:
  `api.acceptFriendRequest(from_uid)` -> `xoaFriendRequest`. Bọc try/catch từng
  dòng (một dòng hỏng không chặn dòng khác).
- Restart-safe: đọc từ DB, không giữ timer trong bộ nhớ. Idempotent: accept xong
  sự kiện ADD tới thì dòng đã xóa (xóa lại vô hại).
- `api` lấy qua `getRunningAccountKenh(id)?.api`; `null`/`undefined` thì bỏ qua.

### 4.4. Config per-account

Thêm 2 field (pattern: `addColumnIfMissing` ở `database.ts` + `AccountConfig`/
`toConfig`/`SELECT`/`updateAccount` ở `account-store.ts` + `patchSchema` ở
`account-routes.ts` + form ở `account-edit-drawer.tsx`):

- `autoAcceptFriends: boolean` - mặc định `false`.
- `autoAcceptFriendDelayMinutes: number` - mặc định `1`, min 0, max 1440 (24h).

Chu kỳ vòng quét: hằng số trong code (30s) - KHÔNG cần chỉnh runtime (YAGNI). Nếu
sau này cần thì đưa vào `tuning-definitions.ts`.

### 4.5. Backend API - `src/server/routes/friend-routes.ts`

Mount `/api/friends` ở `dashboard-server.ts` (tự động sau middleware auth). Lấy
`api` qua `getRunningAccountKenh(accountId)?.api`; `!api` -> 409 "tài khoản chưa
chạy hoặc là kênh bot". Mọi nhánh bọc lỗi, không rò stderr bên thứ ba ra client.

- `GET /:accountId/requests` -> `listFriendRequests` (từ DB, không cần api chạy).
- `GET /:accountId/list` -> `api.getAllFriends()` (live; bọc try/catch, có thể chậm).
- `POST /:accountId/accept` `{ fromUid }` -> `api.acceptFriendRequest(fromUid)` +
  `xoaFriendRequest`. Zod validate body.
- `POST /:accountId/reject` `{ fromUid }` -> `api.rejectFriendRequest(fromUid)` +
  `xoaFriendRequest`.

### 4.6. Frontend

- `web/src/pages/friends-page.tsx` (mới), pattern `contacts-page.tsx`.
- Route: 1 dòng `<Route path="/friends" ...>` ở `app.tsx`; nav: 1 item ở
  `sidebar-nav.tsx` nhóm "Hội thoại"; api-client: thêm methods trỏ `/api/friends`.
- `AccountFilter` chỉ account cá nhân (ẩn/disable bot).
- Mục "Chờ duyệt": bảng avatar/tên/lời nhắn/nhận-lúc + nút Accept / Reject (Reject
  qua `useConfirmDialog`). Poll `setInterval` ~7s (chỉ đọc DB, rẻ).
- Mục "Danh sách bạn": bảng chỉ xem (avatar/tên), lấy khi mở + nút Làm mới (KHÔNG
  poll vì gọi mạng).
- Ghi chú UI: "Chỉ hiện yêu cầu tới từ khi bật tính năng; không lấy lại được yêu
  cầu cũ."

## 5. Luồng dữ liệu

```
Người lạ gửi kết bạn
  -> Zalo -> listener friend_event (REQUEST) -> handleFriendEvent
     -> getUserInfo enrich -> upsertFriendRequest (DB)
Tab Bạn bè (poll 7s) -> GET /requests -> hiện dòng chờ duyệt
  Bấm Accept -> POST /accept -> api.acceptFriendRequest + xóa dòng
  Bấm Reject -> POST /reject -> api.rejectFriendRequest + xóa dòng
Auto (nếu bật): sweep 30s -> dòng quá delay -> acceptFriendRequest + xóa dòng
Sự kiện ADD/REJECT/UNDO tới (từ bất kỳ đường nào) -> xóa dòng pending
Tab "Danh sách bạn" -> GET /list -> getAllFriends() (live)
```

## 6. Xử lý lỗi / ca biên

- `getUserInfo` / `getAllFriends` có thể ném (rate limit) -> bọc, enrich hỏng thì
  lưu UID; list hỏng thì route trả lỗi thân thiện, không crash.
- Account là bot (`api === null`) hoặc chưa chạy (`undefined`) -> route 409; tab ẩn.
- Idempotent: accept rồi ADD event tới -> xóa dòng đã mất, vô hại.
- BẬT auto-accept lúc đang có request chờ: nhịp quét kế tiếp sẽ accept luôn các
  dòng đã quá delay (kể cả request tới trước khi bật) - đây là hành vi mong đợi
  (bật để dọn hàng chờ), không phải lỗi.
- Handler friend_event KHÔNG ném ra listener.
- Tin/UID người lạ: `message`/`sender_name` là chuỗi tự do -> chỉ HIỂN THỊ trên
  dashboard (React tự escape), KHÔNG đưa vào prompt model, KHÔNG dùng dựng lệnh.

## 7. Test (theo kỷ luật project: `setupTestEnv` trước import DB, phá-kiểm)

- `friend-request-store.test.ts`: upsert (trùng PK không đẻ dòng), xóa, list,
  query-quá-hạn (mốc thời gian).
- `friend-event-handler.test.ts`: REQUEST upsert (+ enrich, + isSelf bị bỏ),
  ADD/REJECT/UNDO xóa dòng, REMOVE chỉ log, không ném khi getUserInfo hỏng.
- `friend-auto-accept-sweep.test.ts`: chỉ accept dòng quá delay, tắt toggle thì
  không accept, một dòng hỏng không chặn dòng khác, idempotent.
- `friend-routes.test.ts`: accept/reject gọi api + xóa dòng; 409 khi chưa chạy/bot;
  zod chặn body thiếu `fromUid`.

## 8. File tạo / sửa

Tạo:
- `src/conversation/friend-schema.ts`, `src/conversation/friend-request-store.ts`
- `src/zalo/friend-event-handler.ts`, `src/zalo/friend-auto-accept-sweep.ts`
- `src/server/routes/friend-routes.ts`
- `web/src/pages/friends-page.tsx`
- (+ các file `.test.ts` tương ứng)

Sửa:
- `src/conversation/database.ts` (gọi `taoBangFriendRequests` + 2 cột account)
- `src/zalo/zalo-listener.ts` (thêm `onFriendEvent`)
- `src/zalo/account-manager.ts` (wire handler + khởi động sweep)
- `src/config/account-store.ts` (2 field mới)
- `src/server/routes/account-routes.ts` (`patchSchema` 2 field)
- `src/server/dashboard-server.ts` (mount `/api/friends`)
- `web/src/app.tsx` (Route), `web/src/layout/sidebar-nav.tsx` (nav item)
- `web/src/dashboard-api-client.ts` (methods + type)
- `web/src/pages/account-edit-drawer.tsx` (toggle + ô delay)

## 9. Ngoài phạm vi

- Unfriend / Block / gửi lời mời kết bạn từ dashboard.
- Cache danh sách bạn vào DB.
- Backfill request cũ (Zalo không cho).
- Kênh Zalo Bot chính thức.
- Tự thêm vào allowlist khi accept.

## 10. Câu hỏi treo

Không còn (4 quyết định + delay đã chốt).
