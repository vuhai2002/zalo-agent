# Phase 03 - Ngân sách token thật (khoảng cách D)

## Liên kết ngữ cảnh

- [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html) mục 8/D và mục 6.3
- Code: `src/agent/agent-turn-content.ts`, `src/agent/history-to-model-messages.ts`,
  `src/agent/agent-loop.ts`, `src/conversation/usage-store.ts`

## Tổng quan

- **Ưu tiên**: cao - đang đo nhầm đơn vị
- **Trạng thái**: XONG (commit 0b6718f, sửa tiếp ở 849ad43)
- Chuyển từ đếm **số tin** sang đếm **token**, và cắt bớt ngữ cảnh trước khi tràn.

## Nhận định then chốt

- **Đang đếm nhầm đơn vị.** `HISTORY_CONTEXT_LIMIT=20` là 20 **tin**, mà một tin Zalo dài
  tùy ý. Hai mươi tin dài cộng 8 step x `WEB_FETCH_MAX_CHARS=15000` không ai đo.
- **Hermes quyết định nén theo usage token THẬT từ API**, không theo số tin
  (`agent/context_engine.py`: `update_from_response(usage)` -> `should_compress()`).
- **Trần phụ thuộc model, mà model đặt theo agent** - nên ô này phải nằm ở agent, không
  phải chỉ ở Cấu hình chung. Vẫn giữ nếp "để trống = theo Cấu hình chung" như `maxSteps`.
- ~~**Có sẵn dữ liệu để hiệu chỉnh** từ `agent_turns`~~ - **SAI, đã kiểm chứng**: cột đó là
  `totalUsage` (TỔNG qua mọi step), không phải kích thước một lần gọi; prompt cache đang
  bật; bảng không lưu số ký tự đầu vào. Hiệu chỉnh được bằng cách khác: đo trực tiếp bằng
  bảng BPE của OpenAI lúc phát triển (tiếng Việt 3,1-3,8 ký tự/token với họ o200k nhưng
  chỉ 2,1-2,2 với họ cl100k), cộng log ước lượng cạnh số thật ở mọi lượt.
- **Ảnh mới là thứ nặng nhất**, không phải chữ. Cắt ảnh trước khi cắt tin.
- `stopWhen` nhận `Arrayable<StopCondition>` với `StopCondition = (o:{steps}) => boolean`
  (đã tra `node_modules/ai/dist/index.d.ts:1757`). Chặn phình **trong** một lượt bằng một
  điều kiện dừng riêng, ghép mảng cùng `stepCountIs`.

## Yêu cầu

- Ước lượng số token của input **trước** khi gọi model.
- Vượt ngưỡng thì cắt: ảnh trước, rồi tin cũ nhất, cho tới khi dưới ngưỡng.
- Ghi log ước lượng cạnh số thật để thấy độ lệch.
- Chặn phình trong lượt: tổng usage vượt trần thì dừng vòng, đi vào lượt chốt sẵn có.

## Kiến trúc

```
Truoc luot:
  uocLuongToken(messages) -> so token
  > tranHieuLuc * NGUONG_CAT  ->  catBotNguCanh()
                                    1. bo anh cu nhat truoc
                                    2. bo tin cu nhat
                                  (KHONG dung summary - da co thread-summarizer lo)

Trong luot:
  stopWhen: [ stepCountIs(n), vuotTranToken(tranHieuLuc) ]
             |                 |
             da co             MOI - doc steps[].usage cong don

Sau luot:
  log { uocLuong, thatSu: totalUsage.inputTokens, lech }
```

Trần hiệu lực: `agent.contextWindow ?? getTuning("LLM_CONTEXT_WINDOW")`.

## File liên quan

Sửa:
- `src/conversation/database.ts` - `addColumnIfMissing("agents", "context_window", "INTEGER")`
- `src/config/agent-store.ts` - `contextWindow: number | null`
- `src/config/env.ts` + `.env.example` + `.env.production.example` - `LLM_CONTEXT_WINDOW`
- `src/config/tuning-definitions.ts` - nhóm `ngu-canh`, để chỉnh từ dashboard
- `src/agent/agent-turn-content.ts` - gọi cắt sau khi dựng messages
- `src/agent/agent-loop.ts` - thêm điều kiện dừng, log ước lượng vs thật
- `src/server/routes/agent-routes.ts` - `patchSchema.contextWindow`
- `web/src/pages/agent-model-section.tsx` - ô Trần context

Tạo:
- `src/agent/token-estimate.ts` - ước lượng + hằng số hiệu chỉnh
- `src/agent/trim-context-to-budget.ts` - logic cắt (thuần, test được không cần model)

## Các bước

1. **Đo trước, chọn hằng số sau.** Viết một script dùng một lần đọc `agent_turns` +
   `messages` của DB thật, tính tỉ lệ ký-tự-trên-token trung bình cho tiếng Việt. Ghi kết
   quả vào comment của `token-estimate.ts`. Không có DB đủ dữ liệu thì lấy **2.5** làm mốc
   thận trọng (tiếng Việt tách token tệ hơn tiếng Anh) và ghi rõ đây là ước lượng chưa đo.
2. `token-estimate.ts`: đếm ký tự phần text + cộng chi phí cố định mỗi ảnh (ảnh tính theo
   kích thước, không theo ký tự base64 - base64 không phản ánh số token thị giác). Hàm
   thuần, không import env.
3. `trim-context-to-budget.ts`: nhận `ModelMessage[]` + trần, trả về mảng đã cắt kèm bản
   kê cắt những gì. Thứ tự: ảnh cũ nhất trước, rồi tin cũ nhất. **Không bao giờ cắt** tin
   của lượt hiện tại (batch mới) - cắt vào đó là mất chính câu người dùng vừa hỏi.
4. Cắt ở `agent-turn-content.ts` sau khi `buildTurnMessages` dựng xong, trước khi trả về.
   Hệ số 0.7 phải nằm trong MỘT hàm dùng chung (`nganSachAnToan`) cho cả cắt trước lượt,
   điều kiện dừng giữa lượt, LẪN lượt chốt - ba chỗ tự nhân hệ số riêng là hai nửa của
   cùng một tính năng hiểu con số theo hai nghĩa khác nhau (đã dính thật).
5. Điều kiện dừng mới trong `agent-loop.ts`: cộng dồn `usage` các step, vượt trần thì trả
   `true`. Ghép `stopWhen: [stepCountIs(maxSteps), vuotTranToken(tran)]`.
6. **Kiểm lại nhánh chốt.** `hitStepLimit` đang nhận biết chạm trần bằng *(đủ step + step
   cuối còn gọi tool)*. Dừng vì token thì `steps.length < maxSteps` nên nhánh đó **không**
   kích hoạt, và lượt sẽ trả text của step đang gọi tool - đúng cái bug lượt chốt sinh ra
   để chữa. Phải mở rộng điều kiện vào lượt chốt cho cả trường hợp dừng vì token.
7. Log sau lượt: `{ uocLuong, thatSu, lechPhanTram }`. Đây là cách duy nhất biết hằng số ở
   bước 1 có đúng không.
8. UI: ô số, để trống = theo Cấu hình chung, có gợi ý *"Bỏ trống thì lấy theo trang Cấu hình.
   Đặt riêng khi agent này chạy model có cửa sổ khác."*
9. Test `trim-context-to-budget.ts`: dưới ngưỡng thì không đụng gì; vượt vì ảnh thì bỏ ảnh
   trước; vượt vì chữ thì bỏ tin cũ nhất; **không bao giờ** bỏ tin của lượt hiện tại; cắt
   hết mức vẫn vượt thì trả về mảng nhỏ nhất hợp lệ chứ không trả rỗng.

## Việc cần làm

- [x] Đo tỉ lệ ký tự/token thật từ `agent_turns`, ghi vào comment
- [x] `token-estimate.ts` (thuần) + test
- [x] `trim-context-to-budget.ts` + test 5 nhánh ở bước 9
- [x] Migration `agents.context_window` + `AgentProfile.contextWindow`
- [x] Env `LLM_CONTEXT_WINDOW` đủ 3 nơi + `tuning-definitions.ts`
- [x] Nối cắt vào `agent-turn-content.ts`
- [x] Điều kiện dừng theo token + **mở rộng nhánh lượt chốt**
- [x] Log ước lượng vs thật
- [x] Ô Trần context trên trang sửa agent
- [x] `pnpm test` + `pnpm typecheck`

## Tiêu chí hoàn thành

- Nhồi một thread 30 tin dài rồi chạy: log hiện đã cắt, và `inputTokens` thật nằm dưới trần.
- Độ lệch ước lượng so với thật dưới 25% trên 10 lượt thật (nếu lệch hơn, chỉnh hằng số
  bước 1 - đó chính là lý do có dòng log).
- Dừng vì token vẫn ra câu trả lời tử tế, không phải câu tường thuật nội bộ.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Ước lượng quá thấp -> vẫn tràn thật | Ngưỡng cắt 0.7 trần, hằng số chọn phía thận trọng |
| Ước lượng quá cao -> cắt oan, bot quên chuyện vừa nói | Log lệch để chỉnh; `thread-summarizer` vẫn giữ mạch phần bị cắt |
| Dừng vì token rơi vào nhánh trả text tường thuật | Bước 6 - mở rộng điều kiện vào lượt chốt, có test riêng |
| Thêm dependency tokenizer cho chính xác | Không làm. Đo bằng dữ liệu sẵn có rẻ hơn và không sai kiểu khác khi đổi model |

## An ninh

- Không đổi ranh giới tin cậy nào. Cắt ngữ cảnh không được phép bỏ khối
  `<noi_dung_ngoai>` mà giữ lại phần nội dung bên trong - cắt theo **cả tin**, không cắt
  giữa tin.

## Bước kế tiếp

Phase 05 dùng lại `trim-context-to-budget.ts` cho nhánh lỗi `context_overflow` của provider.
