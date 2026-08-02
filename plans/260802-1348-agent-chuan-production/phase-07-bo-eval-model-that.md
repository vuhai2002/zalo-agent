# Phase 07 - Bộ eval model thật (khoảng cách C)

## Liên kết ngữ cảnh

- [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html) mục 8/C
- Khuyến nghị nguồn: Anthropic - *"test extensively in sandboxes with varied inputs, observe
  model mistakes and refine accordingly"*
- Code: `src/agent/agent-loop.ts` (`AgentTurnParams.resolveModel`, `trace`),
  `src/agent/agent-step-trace.ts` (`StepTrace.toolCalls`),
  `src/agent/run-agent-turn.test.ts` (mẫu dùng `MockLanguageModelV4`)

## Tổng quan

- **Ưu tiên**: cao - không có thì mọi cải tiến sau này đều là đoán
- **Trạng thái**: XONG. 6/6 case đạt với model thật (gpt-combo qua 9Router).
- Dựng `pnpm eval` chạy model thật, khẳng định trên **hành vi** (gọi tool nào), không trên
  câu chữ.

## Nhận định then chốt

- **Model giả không giải quyết được mục đích gốc của C.** Nó trả về đúng thứ mình lập trình
  cho nó trả về, nên không nói được gì về việc model **thật** có hỏi lại, có gọi
  `get_datetime` thay vì đoán ngày, hay có tệ đi sau khi sửa persona không.
- **Phần model giả không phải hạ tầng mới.** Repo đã để test cạnh source và đã dùng
  `MockLanguageModelV4` (`run-agent-turn.test.ts:6`). Phần đó cứ viết thêm test theo nếp
  đang có, trong chính phase 02-06. Phase này chỉ lo phần model thật.
- **Hai thứ cần thiết đã có sẵn**, nên phần mới rất mỏng:
  - `runAgentTurn` nhận seam `resolveModel`, **mặc định chính là model thật** - không
    truyền gì là chạy thật.
  - `StepTrace` đã ghi `toolCalls` từng step, và mảng `trace` do **caller** sở hữu. Khẳng
    định "có gọi `get_datetime` không" đọc thẳng từ đó.
- **Nguy hiểm lớn nhất: eval gửi tin thật lên Zalo.** `runAgentTurn` nhận `api: API` của
  zca-js, và các tool nhóm `action` gọi thẳng `enqueueSend`. Chạy eval với API thật là bot
  nhắn thật cho người thật. **Bắt buộc** tiêm API giả.
- **Khẳng định trên câu chữ là nguồn dao động.** "Câu trả lời phải chứa từ X" sẽ đỏ ngẫu
  nhiên. "Phải gọi tool Y", "không được gọi tool Z", "phải kết thúc bằng dấu hỏi" thì ổn định.

## Yêu cầu

- `pnpm eval` chạy độc lập với `pnpm test`, không nằm trong glob `src/**/*.test.ts`.
- Không có API key thì báo lỗi rõ ràng và thoát, không chạy nửa vời.
- **Không bao giờ** chạm zca-js thật.
- In bảng kết quả, thoát mã khác 0 khi có case đỏ.
- Mỗi case ghi rõ vì sao nó tồn tại - case không có lý do là case sẽ bị xóa nhầm.

## Kiến trúc

```
evals/
  run-eval.ts          runner: doc case, chay tuan tu, in bang, exit code
  fake-zalo-api.ts     API gia - moi ham ghi lai loi goi roi tra ve rong
  eval-case-type.ts    hinh dang mot case
  cases/
    tra-cuu.ts         goi dung tool tra cuu
    ngay-gio.ts        khong doan ngay
    hoi-lai.ts         thieu thong tin thi hoi (phase 08 them)
    cong-cu-hep.ts     agent hep tool thi tu choi dung cach (phase 02)
    dinh-dang.ts       khong con markdown (phase 06)
```

Hình dạng case:

```ts
type EvalCase = {
  ten: string;
  lyDo: string;               // vi sao case nay ton tai
  tinNhan: string;            // nguoi dung nhan gi
  persona?: string;           // override persona neu can
  disabledTools?: string[];   // dung thu agent hep tool
  mongDoi: {
    goiTool?: string[];       // PHAI goi (theo thu tu bat ky)
    khongGoiTool?: string[];  // TUYET DOI khong duoc goi
    kiemTraText?: (t: string) => boolean;  // chi dung cho tinh chat CAU TRUC
  };
};
```

## File liên quan

Tạo: 5 file trong `evals/` như trên.

Sửa:
- `package.json` - `"eval": "tsx evals/run-eval.ts"`
- `.env.example` + `.env.production.example` - ghi chú `pnpm eval` cần `LLM_API_KEY` thật
- `docs/project-roadmap.md` - ghi nhận có bộ eval

## Các bước

1. `fake-zalo-api.ts`: dựng object đủ hình dạng `API` mà các tool đang gọi
   (`addReaction`, `sendMessage`, `sendTypingEvent`, `getGroupInfo`...). Mỗi hàm **ghi lại
   lời gọi** rồi trả về giá trị rỗng hợp lệ. Runner khẳng định được cả "có gửi gì không".
2. Runner dựng DB tạm bằng `setupTestEnv()` **trước** khi `await import()` động các module
   chạm DB - đúng bẫy đã ghi trong `CLAUDE.md`. Xong thì dọn.
3. Mỗi case: dựng `AccountConfig` + `AgentProfile` trong DB tạm, dựng một `ParsedMessage`
   giả, gọi `runAgentTurn({api: fakeApi, account, batch, trace})` **không** truyền
   `resolveModel` (để dùng model thật).
4. Khẳng định đọc từ `trace`: gom `trace.flatMap(t => t.toolCalls)`. So với `goiTool` và
   `khongGoiTool`.
5. `kiemTraText` chỉ dùng cho **tính chất cấu trúc**: kết thúc bằng `?`, không chứa `**`,
   độ dài dưới N. Cấm khẳng định trên nội dung ngữ nghĩa.
6. Chạy **tuần tự**, không song song - tránh đụng rate limit của router và làm kết quả khó đọc.
7. In bảng: tên case, đạt/hỏng, tool đã gọi, số token, thời gian. Có case hỏng thì in thêm
   lý do và `process.exit(1)`.
8. Thiếu `LLM_API_KEY` thì in hướng dẫn và thoát mã 1 ngay từ đầu, không chạy case nào.
9. Viết 5 case đầu (mỗi cái kèm `lyDo`):
   - `ngay-gio`: *"hôm nay thứ mấy?"* -> phải gọi `get_datetime`. Lý do: từng có lỗi bot
     đoán ngày theo dữ liệu huấn luyện.
   - `tra-cuu`: *"giá vàng SJC hôm nay bao nhiêu?"* -> phải gọi `web_search`.
   - `khong-tra-thua`: *"chào bạn"* -> **không** được gọi tool nào. Lý do: gọi tool thừa
     tốn token và làm chậm.
   - `cong-cu-hep`: agent tắt `create_image`, hỏi *"vẽ giúp con mèo"* -> không gọi
     `create_image`, câu trả lời phải là lời từ chối (kiểm bằng độ dài + không chứa "đang vẽ").
   - `dinh-dang`: *"lập bảng so sánh 3 mục giúp tôi"* -> text cuối không chứa `**` hay `##`.
10. Ghi vào `docs/` cách chạy và cách thêm case.

## Việc cần làm

- [x] `fake-zalo-api.ts` ghi lại mọi lời gọi
- [x] `run-eval.ts` + `setupTestEnv()` đúng thứ tự import động
- [x] `eval-case-type.ts` có trường `lyDo` bắt buộc
- [x] 5 case đầu
- [x] Chạy tuần tự, in bảng, exit code đúng
- [x] Thiếu API key thì thoát sớm có hướng dẫn
- [x] `package.json` script `eval`
- [x] `pnpm test` **không** chạy file nào trong `evals/`
- [x] Ghi tài liệu cách thêm case

## Tiêu chí hoàn thành

- `pnpm eval` chạy hết 5 case với model thật, in bảng, không gửi tin nào lên Zalo thật
  (chứng minh bằng bản ghi lời gọi của API giả).
- `pnpm test` vẫn xanh và **không** cần mạng.
- Cố tình sửa persona xấu đi (bỏ dòng dặn tra cứu) -> ít nhất một case đỏ. Đây là phép thử
  cho chính bộ eval: eval không bắt được lỗi khi mình cố tình gây lỗi thì nó vô dụng.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| **Eval gửi tin thật lên Zalo** | API giả bắt buộc; runner từ chối chạy nếu nhận phải API thật |
| Case đỏ ngẫu nhiên vì model dao động | Chỉ khẳng định trên tool call và tính chất cấu trúc, cấm khẳng định ngữ nghĩa |
| Eval lọt vào `pnpm test` làm CI cần mạng + API key | Đặt ngoài `src/`, glob của test là `src/**/*.test.ts` |
| Eval mở nhầm DB thật | `setupTestEnv()` trước mọi import động - bẫy đã ghi trong `CLAUDE.md` |
| Tốn token mỗi lần chạy | Chạy tay trước khi phát hành, không chạy tự động. 5 case là vài nghìn token |

## An ninh

- Eval dùng DB tạm, không đụng `data/zalo-agent.db` thật.
- API giả không có đường nào ra mạng ngoài lời gọi LLM.
- Không đưa cookie Zalo hay khóa thật vào case.

## Bước kế tiếp

Phase 08 dùng bộ này để kiểm chứng dòng persona hỏi lại. Sau đó bổ sung case cho phase 04
(guard chặn đúng lần thứ 5) và phase 05 (lỗi auth không retry).

## Lệch so với kế hoạch (có chủ ý)

- Gộp 6 case vào MỘT file `eval-cases.ts` thay vì 5 file trong `cases/`: mỗi case ~15
  dòng, tách ra là vụn vặt. Tách khi file vượt 200 dòng.
- Cho MỘT file `.test.ts` vào `evals/` (kế hoạch nói không file nào). `chamCase` là chỗ
  dễ sai nhất mà chính bộ eval không tự kiểm được - chạy model thật thì mỗi lần một kết
  quả nên không có mốc để so. File đó thuần, không mạng, không key; `run-eval.ts` không
  phải `.test.ts` nên ràng buộc "CI không cần mạng" giữ nguyên.
- Đi qua `processBatch` (đường production đầy đủ) thay vì gọi thẳng `runAgentTurn`: như
  vậy lớp làm sạch đầu ra của phase 06 và đường gửi cũng nằm trong phép đo.
- Thêm `EVAL_ONLY=ten1,ten2` để chạy tập con - mỗi lượt là token thật.
- Tách `secret-cipher-core.ts` (thuần, nhận khóa qua tham số) khỏi `secret-cipher.ts`:
  bộ eval cần giải mã API key trong DB thật TRƯỚC khi dựng env tạm, mà `env.js` parse
  `process.env` ngay lúc import nên nạp sớm là chốt nhầm giá trị.
- Case `ngay-gio` tách làm hai (`gio-chinh-xac` + `ngay-co-san`) - xem mục dưới.

## Ba lỗi do CHÍNH LẦN CHẠY THẬT bắt được

1. **Lượt hỏng bị chấm ĐẠT.** `processBatch` bắt lỗi rồi nhắn câu "trục trặc kỹ thuật"
   thay vì ném, nên khi router trả 404 thì 3/5 case báo ĐẠT - xanh đúng lúc hệ thống
   hỏng. Chữa bằng `phatHienLuotHong` (0 token, hoặc trùng hằng số báo lỗi production).
2. **Đọc cấu hình từ nguồn KHÁC production.** Bản đầu chỉ đọc `.env`, trong khi model
   cấu hình qua dashboard (DB `runtime_settings`) và DB đè `.env`. Hậu quả: eval gọi
   sai tên model rồi kết luận nhầm là bot hỏng. Chữa bằng `read-real-llm-settings.ts`.
3. **Mong đợi mâu thuẫn với thiết kế.** `ngay-gio` đòi gọi `get_datetime` cho câu hỏi
   ngày, nhưng system prompt CỐ Ý đã có sẵn ngày + thứ nên gọi tool là thừa - đúng thứ
   case `khong-tra-thua` phạt. Tách làm hai: hỏi GIỜ (prompt cố ý không có) phải gọi
   tool, hỏi NGÀY thì không được gọi.
