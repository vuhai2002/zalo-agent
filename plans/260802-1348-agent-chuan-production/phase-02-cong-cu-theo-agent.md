# Phase 02 - Công cụ theo agent (khoảng cách A)

## Liên kết ngữ cảnh

- **Đọc trước**: [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html)
  mục 8/A - có **đính chính** ngày 02/08, bản đầu đề xuất sai hướng
- [reports/thiet-ke-man-hinh-tao-agent.html](reports/thiet-ke-man-hinh-tao-agent.html) mục 00
- Code: `src/agent/tools/tool-registry.ts`, `src/agent/persona-prompt.ts`,
  `src/agent/tools/tool-catalog-types.ts`, `src/config/agent-store.ts`

## Tổng quan

- **Ưu tiên**: cao nhất trong 7 khoảng cách - đây là chỗ sai cấu trúc duy nhất
- **Trạng thái**: XONG (commit 93fa8c4)
- Thêm một lớp lọc tool ở tầng agent, **giao** với lớp account đã có.

## Nhận định then chốt

- **Không phải chuyển cột, mà là thêm lớp.** GoClaw (`internal/tools/policy.go:208`) cho
  **cả agent lẫn group** thu hẹp toolset qua chuỗi giao nhau. Hermes gắn tool **chỉ theo
  nền tảng** (`platform_toolsets`), giống hệt mình. Gắn theo kênh không sai - vấn đề là
  trục agent hiện không có tí quyền nào.
- **Lưu danh sách TẮT, không phải BẬT.** `database.ts:247` ghi rõ lý do: *"Lưu danh sách
  TẮT thay vì BẬT để tool mới thêm vào code tự bật cho account cũ."* Làm allow-list ở agent
  sẽ phá tính chất đó - thêm tool mới vào code thì agent cũ không có.
- **Một bộ lọc dùng cho cả hai nơi.** `listAvailableTools` đang được `buildAgentTools`
  (schema gửi model) **và** `buildSystemPrompt` (mục "Khả năng") cùng gọi. Hai nơi tự lọc
  riêng là sớm muộn cũng lệch, mà lệch nghĩa là persona hứa một tool model không hề nhận
  được. `persona-prompt.test.ts` đã có bất biến canh chuyện này - phải mở rộng, không được
  bỏ qua.

## Yêu cầu

- Agent lưu được danh sách tool tắt riêng.
- Tool vào schema khi: **không bị agent tắt** VÀ **không bị account tắt** VÀ `available()`
  VÀ (không phải lượt cô lập HOẶC `runsInScheduledTurn !== false`).
- Không bên nào bật ngược lại được bên kia.
- Trang sửa agent có nhóm Công cụ, nói rõ kết quả cuối là giao với account.

## Kiến trúc

```
Tool model nhan duoc =
    TOOL_DEFINITIONS
    tru  agent.disabledTools      <- MOI
    tru  account.disabledTools    <- da co
    loc  available()              <- da co
    tru  runsInScheduledTurn:false khi isolated  <- da co
```

Đổi chữ ký (điểm rủi ro chính của phase):

```ts
// truoc
listAvailableTools(account: Pick<AccountConfig,"disabledTools">, context?: {isolated?: boolean})

// sau
listAvailableTools(
  scope: {
    agent: Pick<AgentProfile, "disabledTools">;
    account: Pick<AccountConfig, "disabledTools">;
  },
  context?: { isolated?: boolean },
)
```

## File liên quan

Sửa:
- `src/conversation/database.ts` - `addColumnIfMissing("agents", "disabled_tools", "TEXT NOT NULL DEFAULT '[]'")`
- `src/config/agent-store.ts` - `disabledTools` vào `AgentProfile`, `Row`, `toProfile`, `SELECT`, `updateAgent`
- `src/agent/tools/tool-registry.ts` - đổi chữ ký `listAvailableTools` + `buildAgentTools`
- `src/agent/tools/tool-catalog-types.ts` - `ToolContext` thêm `agent`
- `src/agent/persona-prompt.ts:68` - truyền `{agent, account}`
- `src/agent/agent-loop.ts:192,197` - đã có sẵn biến `agent`, truyền xuống
- `src/server/routes/agent-routes.ts` - `patchSchema` thêm `disabledTools`
- ~~`src/scheduler/run-scheduled-job.ts`~~ - **không cần sửa**: file đó KHÔNG dựng
  `ToolContext`, nó gọi `runAgentTurn` và agent được resolve bên trong `agent-loop.ts`
- `web/src/pages/agent-detail-page.tsx` - thêm nhóm Công cụ

Tạo:
- `web/src/pages/agent-tools-section.tsx` - danh sách tick, chia nhóm read/action

Test phải sửa:
- `src/agent/tools/tool-registry.test.ts`
- `src/agent/persona-prompt.test.ts` (bất biến persona == schema)

## Các bước

1. Migration + mở rộng `agent-store.ts`. Parse JSON hỏng thì trả `[]`, đừng ném - đúng nếp
   `parseDisabledTools` của `account-store.ts`.
2. Đổi chữ ký `listAvailableTools`. TypeScript sẽ chỉ ra hết call site - đi theo lỗi biên dịch.
3. Thêm `agent` vào `ToolContext`, truyền từ `agent-loop.ts` (đã có `getAgentForAccount`).
4. `persona-prompt.ts` truyền cả hai. **Kiểm lại**: `buildSystemPrompt` hiện nhận `account`
   là optional - giữ nguyên tính optional cho cả cụm `{agent, account}` để không phá call
   site nào chỉ dựng prompt xem trước.
5. Mở rộng test bất biến: dựng agent tắt `web_search`, account tắt `create_image`, khẳng
   định **cả** schema **lẫn** mục "Khả năng" trong prompt đều thiếu đúng hai tool đó.
6. Thêm case: agent tắt tool X, account **bật** X -> vẫn không có. Và ngược lại. Đây là
   bằng chứng cho luật "không bên nào bật ngược lại được".
7. API: `patchSchema` thêm `disabledTools: z.array(z.enum(TOOL_KEYS)).optional()` - dùng
   đúng `TOOL_KEYS` như `account-routes.ts:46` để key lạ bị chặn ở biên.
8. UI `agent-tools-section.tsx`: gọi `/api/tools` lấy catalog (đã trả `key/label/description/group/available`).
   Mỗi dòng một tick. Tool `available: false` hiện mờ kèm `unavailableHint`.
9. Dưới danh sách ghi một dòng nói rõ phép giao. Địa chỉ đúng là **trang Tools** -
   công tắc tool per-account nằm ở đó, KHÔNG phải trang Accounts.
10. `pnpm test` + `pnpm typecheck`.

## Việc cần làm

- [x] Migration `agents.disabled_tools`
- [x] `AgentProfile.disabledTools` + đọc/ghi trong `agent-store.ts`
- [x] Đổi chữ ký `listAvailableTools` + sửa hết call site
- [x] `ToolContext.agent` + truyền từ `agent-loop.ts` và scheduler
- [x] Mở rộng bất biến persona == schema cho lớp agent
- [x] Test: agent tắt / account tắt / cả hai / không bên nào
- [x] `patchSchema.disabledTools` dùng `TOOL_KEYS`
- [x] `agent-tools-section.tsx` + dòng giải thích phép giao
- [x] `pnpm test` + `pnpm typecheck` sạch

## Tiêu chí hoàn thành

- Dựng 2 agent khác toolset, gắn lần lượt vào **cùng một** nick, đọc trang Trace thấy
  schema tool khác nhau ở hai lượt.
- Agent tắt `create_image` thì hỏi "vẽ giúp tôi con mèo" bot trả lời là không làm được,
  **không** hứa rồi im (bằng chứng mục "Khả năng" và schema đã đồng bộ).
- Tool mới thêm vào `TOOL_DEFINITIONS` tự có ở mọi agent cũ, không phải sửa DB.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Sót một call site `listAvailableTools`, prompt và schema lệch nhau | Đổi chữ ký (không thêm tham số optional) để TypeScript bắt buộc sửa hết; bất biến ở `persona-prompt.test.ts` canh vòng hai |
| ~~Scheduler dựng `ToolContext` thiếu `agent`~~ | Không xảy ra - scheduler không dựng `ToolContext`. Nhưng `agent` vẫn để **bắt buộc** trong type để call site tương lai không quên |
| Người dùng tắt hết tool ở agent rồi tưởng bot hỏng | `toolCapabilitySection` đã có nhánh "KHÔNG có công cụ nào được bật" - kiểm lại nhánh đó còn chạy |

## An ninh

- Đây là **thu hẹp** quyền, không mở rộng: thêm agent mới không bao giờ nới rộng được
  quyền của một nick. Lỡ tạo agent cẩu thả cũng không thủng.
- Tool bị tắt **không vào schema**, nên model không biết nó tồn tại - vẫn giữ tính chất
  chống prompt injection dụ gọi tool đã có.
- Validate key tool bằng `TOOL_KEYS` ở biên API, không nhận chuỗi tự do vào DB.

## Bước kế tiếp

Phase 03 dùng chung trang sửa. Sau phase 07, thêm case eval khẳng định agent hẹp tool thì
bot từ chối đúng cách thay vì hứa suông.
