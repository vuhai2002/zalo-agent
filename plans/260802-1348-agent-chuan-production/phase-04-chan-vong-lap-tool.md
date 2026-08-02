# Phase 04 - Chặn vòng lặp tool (khoảng cách B)

## Liên kết ngữ cảnh

- [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html) mục 6.1
- Mẫu tham chiếu: `zalo-agent-references/hermes-agent/agent/tool_guardrails.py` (479 dòng)
- Code: `src/agent/agent-loop.ts` (`onStepFinish`, `stopWhen`),
  `src/agent/tools/tool-catalog-types.ts` (`ToolGroup`)

## Tổng quan

- **Ưu tiên**: cao - lỗ đốt tài nguyên duy nhất còn hở trong vòng lặp
- **Trạng thái**: chưa làm. **Độc lập**, làm song song với 05/06 được.
- Nhận biết model gọi lặp một tool vô ích rồi dừng sớm, thay vì để nó đốt hết trần step.

## Nhận định then chốt

- **Hiện chỉ có `stepCountIs(8)`.** Model gọi `web_fetch` cùng một URL lỗi 5 lần liên tiếp
  thì đốt 5/8 step, không ai chặn, người dùng ngồi đợi.
- **Hermes tách 3 loại lặp, không gộp một.** Vì cách chữa khác nhau:
  - `exact_failure` - cùng tool + cùng tham số + lại lỗi. Cảnh báo sau 2, chặn sau 5.
  - `same_tool_failure` - cùng tool lỗi với tham số khác nhau. Cảnh báo 3, dừng 8.
  - `idempotent_no_progress` - tool **chỉ đọc** trả về **cùng kết quả** lặp lại. Cảnh báo 2, chặn 5.
- **Chỉ tool đọc mới áp luật no-progress.** Tool ghi gọi 2 lần ra cùng kết quả là hợp lệ.
  Mình **đã có sẵn** `group: "read" | "action"` trong catalog - dùng luôn, đừng viết danh
  sách thứ hai (đúng luật "Extend, Don't Duplicate" của Hermes).
- **Bộ điều khiển phải thuần.** Hermes cố tình để `before_call`/`after_call` không có tác
  dụng phụ, chỉ trả quyết định; runtime tự quyết biến nó thành cảnh báo, kết quả giả, hay
  dừng lượt. Giữ nếp đó thì test được không cần model.
- **Tool lỗi không nằm trong `toolResults`.** `agent-loop.ts:234` đã ghi rõ: tool ném
  exception cho ra `toolResults` rỗng, lỗi nằm ở `content` dạng `tool-error`. Bộ đếm phải
  đọc **cả hai** nguồn, không thì mọi lỗi thật đều vô hình với guard.
- `stopWhen` nhận mảng điều kiện (`node_modules/ai/dist/index.d.ts:1757`), nên dừng sớm là
  ghép thêm một hàm, không phải ném lỗi.

## Yêu cầu

- Đếm theo **chữ ký lệnh gọi** = tên tool + băm tham số đã chuẩn hóa (sắp khóa, JSON gọn).
- Vượt ngưỡng cảnh báo: ghi log mức WARN, **không** chặn.
- Vượt ngưỡng chặn: dừng vòng lặp, đi vào lượt chốt sẵn có (model phải trả lời bằng thứ đã có).
- Ngưỡng chỉnh được từ trang Cấu hình.
- Guard reset mỗi lượt, và mỗi **lần chạy** trong lượt (có retry glitch router, có dựng lại
  không kèm pixel).

## Kiến trúc

```
src/agent/tool-loop-guard.ts        (thuan, khong import env/logger)
  chuKyLenhGoi(ten, args) -> string
  class ToolLoopGuard
    ghiNhan(step)  -> QuyetDinh { muc: 'cho-qua'|'canh-bao'|'chan', ma, thongDiep }
    datLai()

src/agent/agent-loop.ts
  onStepFinish -> guard.ghiNhan(step); muc==='canh-bao' -> log.warn
  stopWhen: [ stepCountIs(n), () => guard.daChan() ]
```

Ngưỡng lấy từ `getTuning`, truyền vào constructor - module vẫn thuần.

## File liên quan

Tạo:
- `src/agent/tool-loop-guard.ts` (< 200 dòng)
- `src/agent/tool-loop-guard.test.ts`

Sửa:
- `src/agent/agent-loop.ts` - dựng guard, nối `onStepFinish` + `stopWhen`, reset khi `lanChay++`
- `src/config/env.ts` + `.env.example` + `.env.production.example` - 3 biến ngưỡng
- `src/config/tuning-definitions.ts` - nhóm `luot`

Biến mới:
- `TOOL_LOOP_EXACT_FAILURE_BLOCK` (mặc định 5)
- `TOOL_LOOP_SAME_TOOL_BLOCK` (mặc định 8)
- `TOOL_LOOP_NO_PROGRESS_BLOCK` (mặc định 5)

Ngưỡng cảnh báo suy ra (chặn chia 2, tối thiểu 2) để không phình thành 6 biến.

## Các bước

1. `chuKyLenhGoi`: `JSON.stringify(args, sắp khóa, không khoảng trắng)` rồi băm. Băm để
   **không** giữ tham số thô trong bộ nhớ guard (tham số có thể chứa nội dung người dùng).
   Tham số không phải object thì coi như `{}`, đừng ném.
2. `ToolLoopGuard.ghiNhan(step)`: duyệt `step.toolResults` (thành công) **và**
   `step.content` lọc `type === "tool-error"` (thất bại). Băm kết quả của tool đọc để so
   "có tiến triển không".
3. Ba bộ đếm theo đúng ngữ nghĩa Hermes ở mục Nhận định. Tool đọc nhận biết bằng
   `TOOL_DEFINITIONS.find(d => d.key === ten)?.group === "read"`.
4. Quyết định `chan` là **dính** - đã chặn thì các step sau vẫn trả `chan`, không tự gỡ.
5. Nối vào `agent-loop.ts`. Guard dựng **một lần cho cả lượt** nhưng `datLai()` mỗi khi
   `lanChay++` (retry glitch, dựng lại không pixel) - lần chạy mới là ngữ cảnh mới.
6. Dừng vì guard phải vào **lượt chốt**, giống dừng vì token ở phase 03. Nếu làm phase 03
   trước thì dùng chung điều kiện đó; nếu làm phase này trước thì mở rộng `hitStepLimit`
   thành một hàm "có cần lượt chốt không" nhận thêm lý do dừng.
7. Log khi chặn: mức ERROR, kèm tên tool + số lần + mã lý do. Đây là dữ liệu chẩn đoán
   quý nhất khi bot trả lời cụt.
8. Test (không cần model): 4 lần lỗi giống hệt -> cho qua; lần 5 -> chặn. Tool đọc trả
   cùng kết quả 5 lần -> chặn. Tool **ghi** trả cùng kết quả 5 lần -> **không** chặn.
   Lỗi nằm ở `tool-error` (không phải `toolResults`) -> vẫn đếm. `datLai()` xóa sạch đếm.

## Việc cần làm

- [ ] `tool-loop-guard.ts` (thuần, < 200 dòng)
- [ ] Test 6 nhánh ở bước 8
- [ ] Đếm cả `toolResults` lẫn `content[type=tool-error]`
- [ ] Tool đọc nhận biết qua `group === "read"`, không viết danh sách thứ hai
- [ ] Nối `onStepFinish` + `stopWhen` + reset theo `lanChay`
- [ ] Dừng vì guard đi vào lượt chốt
- [ ] 3 biến env đủ 3 nơi + `tuning-definitions.ts`
- [ ] `pnpm test` + `pnpm typecheck`

## Tiêu chí hoàn thành

- Dựng một lượt giả mà `web_fetch` luôn ném lỗi: vòng lặp dừng ở step 5, không chạy hết 8.
- Bot vẫn trả lời người dùng (qua lượt chốt), không im lặng và không trả câu tường thuật.
- Log có một dòng ERROR nói rõ tool nào, bao nhiêu lần, lý do gì.
- Lượt bình thường (không lặp) không đổi hành vi gì - đối chiếu test cũ vẫn xanh.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Chặn nhầm lượt hợp lệ (tra 5 trang khác nhau cùng tool) | Đó là `same_tool_failure` với **args khác nhau**, ngưỡng 8, và **chỉ đếm khi LỖI** - tra thành công không tính |
| Guard giữ tham số nhạy cảm trong RAM | Băm chữ ký, không lưu tham số thô |
| Ngưỡng quá chặt làm bot bỏ cuộc sớm | Mặc định lấy đúng số Hermes đã dùng thật; chỉnh được từ dashboard |
| Reset sai chỗ, guard nhớ sang lượt khác | Guard là biến cục bộ trong `runAgentTurn`, không phải module scope |

## An ninh

- Guard chỉ **thu hẹp** số lần chạy tool, không mở thêm quyền nào.
- Không ghi tham số tool vào log của guard (đã băm) - tham số có thể chứa nội dung riêng
  tư của người nhắn.

## Bước kế tiếp

Sau phase 07, thêm case eval: dựng tool luôn lỗi, khẳng định guard chặn đúng lần thứ 5 và
bot vẫn trả lời.
