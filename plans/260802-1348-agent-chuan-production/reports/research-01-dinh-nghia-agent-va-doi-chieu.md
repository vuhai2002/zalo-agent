# Agent chuẩn là gì, và zalo-agent đang đứng ở đâu

Ngày: 2026-08-02. Nguồn: Anthropic "Building Effective Agents" + "Effective Context
Engineering for AI Agents", OpenAI "A Practical Guide to Building Agents",
12-Factor Agents (HumanLayer), source `hermes-agent`, và đọc thẳng code zalo-agent.

---

## 1. Định nghĩa: agent khác workflow ở chỗ nào

**Anthropic** tách rạch ròi hai thứ mà người ta hay gọi chung là "agent":

- **Workflow**: LLM + tool được điều phối qua **đường code định sẵn**. Dễ đoán,
  hợp việc đã rõ các bước.
- **Agent**: LLM **tự điều khiển tiến trình và cách dùng tool của chính nó**,
  giữ quyền quyết định làm thế nào để xong việc.

Vòng lặp agent: nhận lệnh -> lập kế hoạch -> gọi tool -> nhận kết quả từ môi
trường -> tự đánh giá tiến độ -> lặp lại tới khi xong hoặc chạm điều kiện dừng.

**OpenAI** định nghĩa gọn hơn: agent là hệ tự hoàn thành một quy trình nhiều bước
thay người dùng, có ra quyết định, gọi tool, và **phục hồi được khi hỏng**. Ba
thành phần bắt buộc:

| Thành phần | Vai trò |
|---|---|
| **Model** | Bộ não suy luận |
| **Tools** | Tay chân: thu thập ngữ cảnh hoặc tác động ra ngoài |
| **Instructions** | Luật hành xử và ranh giới |

OpenAI chia tool làm 3 loại: **data** (lấy ngữ cảnh), **action** (tác động), và
**orchestration** (agent gọi agent khác).

### Kết luận cho zalo-agent

`agent-loop.ts` là **agent thật**, không phải workflow: `generateText` +
`stopWhen: stepCountIs(n)` + `tools` -> model tự chọn tool nào, chạy mấy bước,
khi nào dừng. Không có đường code nào ép thứ tự tool. Đúng định nghĩa.

---

## 2. Context engineering - phần zalo-agent làm tốt bất ngờ

Anthropic gọi đây là kỷ luật "chọn tập token tối ưu tại mỗi lần suy luận", và
nêu 3 kỹ thuật cho tác vụ dài hơi:

| Kỹ thuật Anthropic | zalo-agent có chưa | Ở đâu |
|---|---|---|
| **Compaction** (gộp hội thoại cũ thành tóm tắt) | Có | `thread-summarizer.ts` - rolling summary, fire-and-forget sau khi đã trả lời, lỗi không phá lượt chat |
| **Structured note-taking** (agent tự ghi chú ra ngoài) | Có | `save_memory` tool + bảng `memories`, có cả **quy tắc privacy bất đối xứng** (fact học ở DM không bao giờ chảy ra group) |
| **Sub-agent** (agent con, ngữ cảnh sạch) | Chưa | - |

Thêm mấy điểm đúng chuẩn mà nhiều bản triển khai bỏ qua:

- **System prompt chia khối rõ ràng** (`persona-prompt.ts`): persona nền -> ngày
  -> khả năng -> luật từng tool -> persona riêng -> tóm tắt -> trí nhớ -> bối
  cảnh. Đúng khuyến nghị "tổ chức theo section".
- **Chỉ đưa NGÀY, không đưa GIỜ** vào prompt - giờ đổi mỗi phút sẽ vỡ prompt
  cache mỗi phút. Đây là chi tiết ít người nghĩ tới.
- **Mục "khả năng" sinh từ ĐÚNG bộ lọc dựng schema** (`listAvailableTools` dùng
  chung cho cả `buildAgentTools` lẫn `buildSystemPrompt`). Chặn hẳn lớp bug
  "prompt hứa một tool mà model không hề nhận được".
- **Cắt output tool** (`WEB_FETCH_MAX_CHARS=15000`) - đúng nguyên tắc token
  efficiency.
- **Tool bị tắt biến mất khỏi schema**, không phải "có nhưng trả lỗi" - vừa tiết
  kiệm token mô tả vừa chặn injection dụ gọi.

---

## 3. Guardrails - đối chiếu với mô hình phân lớp của OpenAI

OpenAI nói rõ: một lớp guardrail không đủ, phải xếp nhiều lớp chuyên biệt.

| Lớp guardrail OpenAI | zalo-agent |
|---|---|
| Relevance / lọc đầu vào | Có - allowlist + @mention lọc **trước** khi gọi LLM (không tốn token) |
| Chống prompt injection | **Mạnh** - `wrap-untrusted-content.ts` bọc nội dung web trong `<noi_dung_ngoai>`, **khử luôn tên thẻ trong nội dung** để trang web không đóng ranh giới sớm. Cộng nhãn `[chưa xác minh]` cho người ngoài allowlist trong history |
| PII / bảo mật dữ liệu | Một phần - quy tắc privacy bất đối xứng của memory; chưa có redact chủ động |
| Đánh giá rủi ro tool | Có - `group: read \| action` + `runsInScheduledTurn` |
| Rules-based | Có - SSRF guard (`private-address-guard.ts`), rate limit theo thread, trần gửi chủ động/ngày (bảng bền) |
| Kiểm tra đầu ra | **Chưa có** - text model trả về đi thẳng xuống Zalo |
| Human-in-the-loop | **Chưa có** |

Cấm tool tài chính là một lựa chọn **phạm vi**, không phải guardrail - nhưng là
lựa chọn đúng cho bot đọc tin người lạ.

---

## 4. Chịu lỗi - chỗ zalo-agent trên mức trung bình

Mấy nhánh này hiếm thấy ở bản tự viết:

1. **Lượt chốt khi hết step** (`runWrapUp`): chạm trần step thì gọi lại model
   **không cấp tool**, ép nó viết câu trả lời từ dữ liệu đã thu được. Không có
   nhánh này thì người dùng nhận đúng câu tường thuật nội bộ ("Đủ 2 nguồn - giờ
   đối chiếu") làm câu trả lời.
2. **Nhận diện completion rỗng của router** (`isEmptyRouterCompletion`): HTTP 200
   + 0 token + 0 tool call. SDK coi là thành công nên `maxRetries` không cứu.
3. **Fallback khi provider từ chối ảnh**: bắt 4xx -> ghi nhớ model mù -> dựng lại
   input không pixel -> thử lại 1 lần.
4. **Trace sống sót qua throw**: mảng `trace` do **caller** sở hữu, agent-loop
   chỉ push. Lượt chạy tốt 5 step rồi step 6 gặp 500 vẫn còn đủ manh mối.
5. **Log cả `tool-error`**, không chỉ `toolResults` - vì tool ném exception
   không bao giờ lọt vào `toolResults` (đo thật với `ai@7.0.37`).
6. **Sanitizing fetch**: cắt đuôi `data: [DONE]` mà 9Router dính vào body JSON.

---

## 5. Đối chiếu 12-Factor Agents

| Factor | Trạng thái |
|---|---|
| 1. NL -> tool call | Đủ |
| 2. Tự sở hữu prompt | Đủ - viết tay, không framework |
| 3. Tự sở hữu context window | Đủ - `buildTurnMessages` dựng tay từng phần |
| 4. Tool là structured output | Đủ |
| 5. Gộp execution state + business state | Đủ - SQLite là cả hai |
| 6. Launch/pause/resume | Một phần - scheduler có job, lượt agent thì không dừng/tiếp được |
| 7. **Gọi người qua tool call** | **Thiếu** |
| 8. Tự sở hữu control flow | Đủ |
| 9. Nén lỗi vào context | Một phần - lỗi tool quay lại model qua SDK, nhưng không phân loại |
| 10. Agent nhỏ, tập trung | Một phần - một agent, chưa có agent con |
| 11. Kích hoạt từ mọi nơi | Một phần - Zalo + scheduler; chưa có webhook/API |
| 12. Agent là stateless reducer | **Thiếu** - `runAgentTurn` tự đọc DB (`getRecentMessages`, `getMemoriesForContext`) thay vì nhận state từ ngoài |

---

## 6. Hermes có gì mà zalo-agent chưa có

Đọc `D:\source-code\zalo-agent-references\hermes-agent\agent\` (114k dòng Python).
Lọc ra những thứ **đáng học**, bỏ những thứ chỉ hợp agent coding:

### 6.1 `tool_guardrails.py` (479 dòng) - đáng học nhất

Chống vòng lặp tool ở mức chữ ký lệnh gọi:

- `ToolCallSignature` = tên tool + **hash JSON args đã chuẩn hóa** (sort key,
  compact) - nhận diện được "gọi y hệt lần trước".
- Ba bộ đếm riêng:
  - `exact_failure` - đúng tool + đúng args + lại lỗi. Cảnh báo sau 2, chặn sau 5.
  - `same_tool_failure` - cùng tool lỗi với args khác nhau. Cảnh báo 3, dừng 8.
  - `idempotent_no_progress` - tool **chỉ đọc** trả về **cùng kết quả** lặp lại.
    Cảnh báo 2, chặn 5.
- Chia sẵn `IDEMPOTENT_TOOL_NAMES` vs `MUTATING_TOOL_NAMES` - tool đọc mới áp
  luật no-progress được, tool ghi thì không (ghi 2 lần khác nhau là hợp lệ).
- Bộ điều khiển **thuần, không side effect**: `before_call` / `after_call` trả về
  quyết định (`allow`/`warn`/`block`/`halt`), runtime tự quyết biến quyết định đó
  thành warning, tool result giả, hay dừng lượt.
- Mặc định `warnings_enabled=True`, `hard_stop_enabled=False` - phiên tương tác
  chỉ bị nhắc nhẹ, chặn cứng phải bật tường minh.

**zalo-agent hiện chỉ có `stepCountIs(8)`.** Model gọi `web_fetch` cùng một URL
lỗi 5 lần liên tiếp thì đốt 5/8 step, không ai chặn, người dùng ngồi đợi.

### 6.2 `iteration_budget.py` (62 dòng)

Bộ đếm lượt lặp có khóa, **có `refund()`** - lượt gọi code lập trình được hoàn
lại để không ăn vào ngân sách. Mỗi agent con có ngân sách độc lập.

### 6.3 `context_engine.py` (489 dòng)

Context engine cắm rời được, vòng đời rõ:
`on_session_start` -> `update_from_response(usage)` -> `should_compress()` ->
`compress()` -> `on_session_end`.

Điểm mấu chốt: **quyết định nén dựa trên usage token THẬT trả về từ API**, không
phải đếm số tin. zalo-agent đang đếm **20 tin** (`HISTORY_CONTEXT_LIMIT`), mà một
tin Zalo có thể dài tùy ý.

Thêm `sanitize_memory_context()`: redact + cắt đầu-đuôi (giữ 4000 ký tự đầu,
1500 cuối) khi ngữ cảnh memory vượt 6000 ký tự - **cắt giữa chứ không cắt đuôi**,
vì phần cuối thường là thứ mới nhất.

### 6.4 `error_classifier.py` (1699 dòng)

Phân loại lỗi provider để quyết định retry / đổi model / bỏ cuộc. zalo-agent
retry mù `maxRetries: 2` + 2 nhánh đặc thù. Hết quota, context tràn, và mạng chập
đang được xử lý y như nhau.

### 6.5 `memory_manager.py`

Đáng chú ý: **chỉ cho phép MỘT memory provider ngoài tại một thời điểm** - chặn
phình schema tool và backend trí nhớ đá nhau. Kèm `normalize_tool_schema()` xử lý
ca schema bị bọc 2 lần khiến DeepSeek trả 400 và **hỏng cả toolset**.

### 6.6 Cái Hermes có mà zalo-agent **không nên** lấy

`auxiliary_client.py` 8255 dòng, `conversation_loop.py` 6645 dòng, MoA loop, LSP,
browser provider, credential pool. Hermes là agent coding đa nền tảng - độ phức
tạp đó không mang lại gì cho bot Zalo cá nhân. Giữ nguyên quyết định "tự viết
agent loop, không dùng framework".

---

## 7. Khoảng cách so với hình dạng agent hiện đại (ảnh ChatGPT Agent Builder)

Ảnh mẫu cho thấy một Agent hiện đại **sở hữu** những thứ này:

```
Agent
├── Channels        (ChatGPT, Slack, API)
├── Apps / Tools    (Browse apps)
├── Skills          (Add skill)
├── Files           (Upload files -> knowledge base)
├── Memory
└── Instructions
```

zalo-agent hiện tại:

```
Account (Zalo credential)          Agent (bảng `agents`)
├── allowlist                      ├── persona
├── disabledTools   <-- TOOL Ở ĐÂY ├── modelProvider / modelName
├── autoReact...                   ├── maxSteps
└── agent_id ---------------------> └── reasoningEffort
```

**Đây là chênh lệch cấu trúc lớn nhất.** Xác nhận bằng code:
`disabled_tools` là cột của bảng `accounts` (`database.ts:249`), `agent_id` cũng
ở `accounts` (`database.ts:74`), và `agent-routes.ts` không hề có trường tools.

Hệ quả thật:

- Đổi agent của một account -> **toolset không đổi theo**.
- Hai account dùng chung một agent -> **hai toolset khác nhau**.
- Không dựng được "Trợ lý bán hàng" (chỉ web_search + create_excel) và "Trợ lý
  kỹ thuật" (đủ tool) rồi gắn/tháo trên cùng một nick.

Theo cả OpenAI lẫn Anthropic, **Agent = instructions + tools + model**. Tool là
thuộc tính của agent, không phải của kênh.

Thiếu thêm: **Files/knowledge base** cho agent (không có RAG), và **memory gắn
theo agent** (memory hiện gắn theo account + subject).

---

## 8. Danh sách khoảng cách, xếp theo mức đáng làm

| # | Khoảng cách | Vì sao đáng | Độ khó |
|---|---|---|---|
| A | **Agent không sở hữu toolset** | Sai định nghĩa agent; chặn hẳn use case nhiều persona trên một nick | Trung bình - thêm cột `agents.disabled_tools`, đổi thứ tự ưu tiên trong `listAvailableTools`, thêm UI |
| B | **Không có loop guardrail** | Tool lỗi lặp đốt hết step, người dùng đợi vô ích. Có mẫu sẵn ở Hermes | Trung bình - module thuần + nối vào `onStepFinish` |
| C | **Không có eval** | 92 test đều là unit test hành vi code. Sửa persona hay mô tả tool là bay mù, không biết có làm tệ đi không | Trung bình - cần bộ case + model giả |
| D | **Ngân sách theo TIN, không theo TOKEN** | 20 tin dài + 8 step tool có thể tràn context mà không ai đo | Nhỏ - đọc `usage` đã có sẵn trong result |
| E | **Không có kiểm tra đầu ra** | Text model đi thẳng xuống Zalo. Không chặn được rò system prompt hay markdown lọt lưới | Nhỏ |
| F | **Không có human-in-the-loop** | 12-factor #7. Tool gửi file / vẽ ảnh / tag không có bước xác nhận | Trung bình - cần đường chờ phản hồi |
| G | **Không phân loại lỗi provider** | Hết quota, context tràn, mạng chập đang bị xử lý như nhau | Nhỏ - bảng ánh xạ, không cần 1699 dòng |
| H | **Không có agent con** | Anthropic khuyến nghị cho research song song | Lớn - và **có thể chưa cần** cho bot cá nhân |
| I | **Agent không có knowledge base** | Ảnh mẫu có "Upload files". Cần RAG | Lớn |

---

## 9. Chốt lại

**Đã đúng chuẩn agent chưa?** Rồi, về bản chất vòng lặp. Đây là agent thật theo
đúng định nghĩa Anthropic: model tự điều khiển tiến trình và tool của nó, có
điều kiện dừng, có phản hồi từ môi trường.

**Đã production chưa?** Phần **chịu lỗi và chống injection thì trên mức trung
bình rõ rệt** - lượt chốt không cấp tool, nhận diện completion rỗng, fallback
ảnh, trace sống qua throw, khử tên thẻ trong nội dung web. Mấy thứ này thường
chỉ xuất hiện sau khi đã bị đau thật ở production.

Phần **còn thiếu để gọi là production-grade đầy đủ** là 3 thứ, theo đúng thứ tự:

1. **Eval harness** (C) - không có thì mọi cải tiến sau này đều là đoán.
2. **Loop guardrail** (B) - lỗ hổng đốt tài nguyên duy nhất còn hở trong vòng lặp.
3. **Ngân sách token thật** (D) - hiện đang đếm nhầm đơn vị.

**Sai định nghĩa ở đâu?** Đúng một chỗ: **agent không sở hữu tool của chính nó**
(A). Đây là thứ nên sửa trước nếu mục tiêu là "đúng cấu trúc chuẩn của một agent".

---

## Câu hỏi còn treo

1. Mục tiêu ưu tiên là **đúng định nghĩa agent** (làm A trước) hay **an toàn vận
   hành** (làm C + B + D trước)?
2. Agent con (H) và knowledge base (I) có nằm trong phạm vi bot Zalo cá nhân
   không, hay để ngoài như đã loại "gửi tin hàng loạt"?
3. Human-in-the-loop (F) muốn hình dạng nào - bot hỏi lại trong chat, hay nút
   duyệt trên dashboard?
