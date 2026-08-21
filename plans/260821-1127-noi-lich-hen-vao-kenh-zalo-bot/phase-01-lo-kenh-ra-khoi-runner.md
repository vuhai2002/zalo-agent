# Phase 01 - Lộ `KenhLuot` ra khỏi runner

Ưu tiên: cao (chặn mọi phase sau). Trạng thái: [x] xong.
Bối cảnh: [reports/nguyen-nhan-goc.md](reports/nguyen-nhan-goc.md) mục 3.

## Vấn đề

`kenhBot(client)` dựng bên trong `chayTaiKhoanBot` và chỉ đi vào callback
`onUpdate` của vòng poll. `running` map chỉ giữ `api: null`. Không có đường
nào cho một caller chỉ cầm `accountId` (scheduler) lấy được đường gửi.

## Cách làm

Thêm `kenh: KenhLuot` vào `RunningAccount` - đây đúng chỗ, vì `running` vốn đã
LÀ sổ đăng ký account đang sống, và `api` hiện có chỉ là một trường CON của
`KenhLuot`. Sau đó `getRunningAccountApi` suy ra từ `kenh.api` thay vì giữ
bản sao thứ hai.

### Files sửa

| File | Việc |
|---|---|
| `src/zalo-bot/bot-account-runner.ts` | `chayTaiKhoanBot` trả `{ dung, kenh }` thay vì `{ dung }` |
| `src/zalo/account-manager.ts` | `RunningAccount.api` -> `RunningAccount.kenh`; `getRunningAccountApi` đọc `kenh.api`; thêm `getRunningAccountKenh` |

### Chi tiết

1. `bot-account-runner.ts`: `const kenh = kenhBot(client)` đã có sẵn ở dòng
   108 - chỉ việc `return { ...vong, kenh }`. Kiểu trả về đổi thành
   `Promise<{ dung: () => void; kenh: KenhLuot }>`.

2. `account-manager.ts`:
   - `attachAccount` (kênh cá nhân): `const kenh = kenhCaNhan(api)` rồi
     `running.set(id, { config, kenh, selfId, stopListener })`.
   - `startBotAccount`: nhận `kenh` từ `chayTaiKhoanBot` rồi lưu vào
     `running.set`.
   - `getRunningAccountApi(id)` -> `running.get(id)?.kenh.api ?? undefined`.
     Giữ nguyên chữ ký và ngữ nghĩa cũ (`undefined` cho bot) để không phá
     caller nào.
   - Thêm:
     ```ts
     export function getRunningAccountKenh(accountId: string): KenhLuot | undefined {
       return running.get(accountId)?.kenh;
     }
     ```

3. **KHÔNG đụng `incoming-message-router.ts`.** Nó nhận `api` thẳng từ callback
   listener và còn dùng `api` cho việc riêng của zca-js
   (`sendDeliveredReceipt`, `getGroupInfo`), nên chuyển nó sang `KenhLuot` là
   một đợt refactor khác. Hệ quả: có HAI thực thể `kenhCaNhan(api)` cho cùng
   một account (một dựng lúc attach, một dựng mỗi batch). An toàn vì
   `kenhCaNhan` là nhà máy THUẦN trên `api` - ghi ràng buộc đó thành comment
   trong `kenh-ca-nhan.ts` để lần sau ai định nhét state vào đó thì đọc được.

## Tests

File mới: `src/zalo/account-manager-kenh.test.ts`

| # | Ca | Khẳng định |
|---|---|---|
| 1 | `attachAccount` xong | `getRunningAccountKenh(id)!.api === api` đã gắn; gọi `duongGui("t1", 0)({text:"x"})` thì `api.sendMessage` nhận đúng `"x"` |
| 2 | tài khoản BOT chạy xong | `kenh.api === null`, `kenh.tranKyTuMotTin === 2000`, `duongGui("c1")({text:"y"})` gọi `client.sendMessage("c1","y",null)` |
| 3 | hợp đồng cũ | `getRunningAccountApi` vẫn trả api cho cá nhân, `undefined` cho bot |
| 4 | `stopAccount` | `getRunningAccountKenh` trả `undefined` sau khi dừng |
| 5 | account bot bị TẮT giữa lúc khởi động | `dung()` được gọi VÀ `getRunningAccountKenh` trả `undefined` (không để lại kênh mồ côi) |

Ca 2 và 5 dùng `tiemClientRunnerChoTest` (`bot-account-runner.ts:27`) để không
đi ra mạng - đã có sẵn, không phải dựng mới.

Ca 1 dùng khuôn `attachOnline` của `run-scheduled-job.test.ts` (api giả với
`listener.*` no-op).

### Phép phá bắt buộc

| Phá gì | Ca phải ĐỎ |
|---|---|
| `getRunningAccountKenh` luôn trả `kenhCaNhan(api!)` | 2 |
| `startBotAccount` không lưu `kenh` (để `undefined`) | 2, 5 |
| `getRunningAccountApi` trả thẳng `null` thay vì `kenh.api` | 1, 3 |

## Tiêu chí xong

- 5 ca xanh, 3 phép phá đều đỏ đúng ca dự kiến.
- `pnpm typecheck` sạch.
- `src/zalo/*.test.ts` + `src/zalo-bot/*.test.ts` xanh nguyên (không hồi quy).
- `account-manager.ts` vẫn dưới 200 dòng.

## Rủi ro

- `RunningAccount.api` đổi hình dạng: mọi chỗ đọc trường đó phải sửa theo.
  Grep đã chốt chỉ có `getRunningAccountApi` đọc nó. TypeScript bắt phần còn lại.
- `attachAccount` ném lỗi khi `config.loai === "bot"` - lá chắn cuối, giữ nguyên.
