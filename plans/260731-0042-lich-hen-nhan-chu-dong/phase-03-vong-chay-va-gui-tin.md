# Phase 03 - Vòng chạy và gửi tin

Liên kết: [plan.md](plan.md) - [Thiết kế mục 5, 6, 8](reports/thiet-ke-scheduler.md) -
[Phase 02](phase-02-luu-tru-va-ngu-nghia-lich.md)

## Tổng quan

- Ưu tiên: cao - đây là lúc bot bắt đầu tự nhắn thật
- Trạng thái: chưa bắt đầu
- Vòng tick, chạy một job, và toàn bộ lớp chặn trước khi gửi

## Nhận định then chốt

**Clear-before-dispatch** (goclaw `checkJobs`): ghi `next_run_at` mới NGAY khi gom job due,
trước khi dispatch. Một process nên chỉ cần thế, không cần claim TTL như Hermes.

**Không await trong tick.** goclaw học bài này bằng máu: `wg.Wait()` trong vòng lặp khiến
một job treo làm đứng cả scheduler. Một job agent có thể chạy vài phút (đo được lượt nặng
nhất của repo là 236 giây).

**Đi qua `threadChains` sẵn có.** Job và tin người dùng cùng thread không được chồng nhau -
lượt sau đọc history trước khi lượt trước ghi xong là ra hai câu trả lời mâu thuẫn, đúng
lỗi `message-batcher` đã trị. Tách `runOnThreadChain` ra dùng chung thay vì dựng hàng đợi
thứ hai song song.

**Job lỗi thì im** (luật goclaw: chỉ output thành công mới deliver). Ở lượt tin nhắn có
người đang ngồi chờ nên phải báo; ở đây không ai chờ, nhắn "trục trặc kỹ thuật" lúc 7h
sáng chỉ là spam. Nhưng phải THẤY được: `last_error` + badge đỏ trên dashboard.

**Vào input thì cô lập, ra output thì ghi history.** Không ghi thì user trả lời "ok làm
rồi" mà bot không biết đang nói chuyện gì.

## Yêu cầu

**Chức năng**
- Tick mỗi `SCHEDULER_TICK_MS`, gom job due, dispatch không chặn
- Job `message`: gửi thẳng, 0 token. Job `agent`: chạy lượt cô lập, hiểu `[SILENT]`
- Lúc boot: run còn `running` thành `interrupted`, job quá hạn tính lại mốc
- Guard trước mỗi lần gửi: account chạy, thread hợp lệ, chưa chạm trần ngày
- Rải đều toàn cục giữa các tin chủ động

**Phi chức năng**
- Lượt agent theo lịch phải lên trang Trace và tính token như lượt thường
- `SCHEDULER_ENABLED=false` thì không tick, không đăng ký gì

## Kiến trúc

```
index.ts  ->  startScheduler()
                  |
            scheduler-loop.ts   tick: listDueJobs -> decideDueAction -> setNextRun
                  |                   -> runOnThreadChain(threadKey, ...) [không await]
            run-scheduled-job.ts
                  |-- kind=message -> guard -> gửi
                  +-- kind=agent   -> openAgentTurn(source='schedule')
                                      -> runAgentTurn({isolated:true})
                                      -> finishAgentTurn + saveTurnTrace
                                      -> [SILENT]? -> guard -> gửi -> appendMessage
            proactive-send-guard.ts   trần ngày (theo ngày VN), rải đều, kiểm thread
```

Lượt agent bọc trong `runInTurnLogContext` để mọi dòng log mang `turnId` - hạ tầng đã có
sẵn từ đợt trước, không phải làm gì thêm.

## File liên quan

**Tạo**: `src/scheduler/scheduler-loop.ts` (+test), `src/scheduler/run-scheduled-job.ts`
(+test), `src/scheduler/proactive-send-guard.ts` (+test),
`src/scheduler/silent-sentinel.ts` (+test)

**Sửa**:
- `src/middleware/message-batcher.ts` - tách và export `runOnThreadChain`
- `src/agent/agent-loop.ts` - thêm `isolated?: boolean`
- `src/agent/tools/tool-registry.ts` - thêm `runsInScheduledTurn`, `buildAgentTools` lọc theo
- `src/index.ts` - start/stop scheduler

## Các bước

1. `message-batcher.ts`: tách phần `previous.then(...)` + dọn entry thành
   `runOnThreadChain(threadKey, fn)`, `flush` gọi lại nó. **Giữ nguyên hành vi** - test rò
   rỉ Map hiện có phải vẫn xanh.
2. `agent-loop.ts`: `isolated?: boolean` (mặc định false). Bật thì bỏ `getRecentMessages`,
   `getMemoriesForContext`, `getThreadSummary` - truyền mảng rỗng và memory rỗng vào.
   Persona giữ nguyên.
3. `tool-registry.ts`: `runsInScheduledTurn?: boolean` (mặc định true). Đặt `false` cho
   `add_reaction` (không có `msgId` thật), `read_image` (lượt này không có ảnh),
   `save_memory` (đường web -> trí nhớ vĩnh viễn là injection thật). `schedule_task` sẽ đặt
   `false` ở phase 04 khi thêm tool. `listAvailableTools` nhận thêm cờ ngữ cảnh.
4. `silent-sentinel.ts`: chép luật `_is_cron_silence_response` của Hermes - nhận khi
   sentinel là toàn bộ câu trả lời, hoặc đứng riêng ở dòng đầu / dòng cuối, hoặc mở đầu
   dạng `[SILENT] ...`; nhưng nằm GIỮA câu thì vẫn gửi.
5. `proactive-send-guard.ts`: kiểm theo thứ tự account chạy -> thread trong bảng `threads`
   và `bot_enabled=1` -> trần ngày (dùng `startOfDayUtc` của phase 01). Trả lý do dạng chữ
   để ghi vào `scheduled_job_runs.detail`. Kèm hàng đợi rải đều `SCHEDULER_SEND_GAP_MS`.
6. `run-scheduled-job.ts`: đúng luồng ở phần Kiến trúc. Ghép prompt theo khối hướng dẫn ở
   mục 6 của thiết kế. `once` trễ quá grace thì thêm tiền tố "(nhắc trễ, lịch gốc HH:MM)".
7. `scheduler-loop.ts`: `startScheduler()` / `stopScheduler()`, tick `.unref()`, phục hồi
   lúc boot. Bọc tick trong try/catch - một job hỏng không được giết vòng lặp (goclaw có
   `safeCheckJobs` với panic recovery đúng lý do này).
8. `index.ts`: gọi `startScheduler()` sau `startAllAccounts()`, `stopScheduler()` trong
   `shutdown()`.

## Todo

- [ ] Tách `runOnThreadChain`, test cũ vẫn xanh
- [ ] `agent-loop.ts` nhận `isolated`
- [ ] `runsInScheduledTurn` + lọc 3 tool
- [ ] `silent-sentinel.ts` + test (gồm ca sentinel giữa câu vẫn gửi)
- [ ] `proactive-send-guard.ts` + test (trần ngày theo giờ VN)
- [ ] `run-scheduled-job.ts` + test (model giả, dùng seam `resolveModel` sẵn có)
- [ ] `scheduler-loop.ts` + test
- [ ] Đấu vào `index.ts`
- [ ] `pnpm typecheck` + `pnpm test` sạch

## Tiêu chí hoàn thành

- Job `message` gửi được với 0 lượt agent (khẳng định `agent_turns` không tăng)
- Job `agent` trả `[SILENT]` thì không gửi gì, run ghi `silent`
- Job `agent` chạy được thì có dòng `agent_turns` với `source='schedule'` và có trace
- Job lỗi: không tin nào ra Zalo, `last_error` có nội dung, run ghi `error`
- Trần ngày chặn ở tin thứ 11 trong cùng thread cùng ngày VN
- Tick không bị chặn: test có một job chạy lâu vẫn cho tick kế chạy
- Lượt agent theo lịch KHÔNG nhận được `add_reaction`, `read_image`, `save_memory`

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Bot spam thật lúc thử | Nghiệm thu bắt đầu bằng đúng một job `once`, chưa bật `every` |
| `runOnThreadChain` tách sai làm hỏng đường tin nhắn thường | Không đổi logic, chỉ đổi chỗ đặt; test rò rỉ Map hiện có là lưới đỡ |
| `isolated` lỡ áp nhầm cho lượt tin nhắn | Mặc định false, và test khẳng định lượt thường vẫn đọc history |
| Job treo giữ chỗ trong `threadChains`, khoá thread | `LLM_TURN_TIMEOUT_MS` đã có sẵn chặn trên cho cả lượt |

## An toàn

- Loại `save_memory` khỏi lượt theo lịch: chặn đường nội dung web đi vào trí nhớ vĩnh viễn
- Guard kiểm `bot_enabled` nghĩa là tắt bot cho một thread trên dashboard cũng tắt luôn
  mọi job đang nhắm vào đó - một cái công tắc, không phải hai
- Job lỗi không gửi gì nên prompt injection không dựng được kênh phản hồi qua lỗi

## Tiếp theo

Phase 04 thêm tool cho model tự tạo/hủy job.
