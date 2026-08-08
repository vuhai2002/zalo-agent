# Phase 04 - Tool kb_search

**Ưu tiên:** cao. Đây là chỗ kho tri thức thật sự tới được model.
**Trạng thái:** XONG. **Cần:** phase 03.

## Bối cảnh

- Mẫu tool đọc: `src/agent/tools/tool-catalog-read.ts`, `web-search-tool.ts`
- Đánh dấu nhánh hỏng: `src/agent/tools/tool-failure-result.ts` (`ketQuaLoi`)
- Thẻ bọc nội dung ngoài: `src/agent/prompt-leak-markers.ts` (`THE_NOI_DUNG_NGOAI`)
- Luật persona theo tool: `src/agent/persona-tool-rules.ts`
- Bộ quét schema nhà cung cấp: `src/agent/tools/tool-schema-provider-compat.test.ts`

## Nhận định then chốt

**Nạp bằng TOOL, không tự nhét vào prompt.** goclaw cũng chọn vậy và ghi rõ ở
mục Limitations của họ. Lý do quyết định ở repo này là prompt cache: repo đã
đầu tư khóa phiên cache (`cache-session-id.ts`), mà nhét kết quả tìm kiếm vào
đầu prompt là phá đúng khoản đầu tư đó, và tốn token cả những lượt người ta chỉ
chào hỏi. (Hermes đi hướng ngược - `prefetch_all` trước mỗi lượt.)

**Bọc `<noi_dung_ngoai>`.** Nội dung KB do người vận hành nạp nên tin cậy hơn
web, nhưng vẫn là chữ đi thẳng vào prompt. Một file hướng dẫn lỡ chứa câu "bỏ
qua mọi quy tắc" là chuyện có thể xảy ra do sơ ý. Persona đã có sẵn luật cho
thẻ này - dùng lại, không phát minh thẻ mới.

**Tool phải TỰ CÓ MẶT hay không theo agent.** Agent chưa gán nguồn nào thì tool
không nên xuất hiện trong schema - đúng nếp `available()` của `read_image` (chỉ
vào schema khi sidecar đã cấu hình). Bày một tool luôn trả rỗng là dạy model
gọi vô ích và tốn một step.

**Trần ký tự áp cho TOÀN BỘ kết quả, không phải từng đoạn.** 5 đoạn x 1600 ký
tự là 8000 ký tự trong một kết quả tool - đủ đẩy ngữ cảnh sát trần.

## File

**Tạo:**
- `src/agent/tools/kb-search-tool.ts`
- `src/agent/tools/kb-search-tool-description.ts`
- `src/agent/tools/kb-search-tool.test.ts`

**Sửa:**
- `src/agent/tools/tool-catalog-read.ts` - thêm mục `kb_search`
- `src/agent/persona-tool-rules.ts` - luật khi nào tra kho
- `src/agent/tools/tool-catalog-types.ts` - không đổi, chỉ dùng lại `available()`

## Giao diện

**Consumes:** `timTrongKhoTriThuc({ cauHoi, agentId, soLuong })` (phase 03),
`nguonCuaAgent(agentId)` (phase 01).

**Produces:**
```ts
export function createKbSearchTool(ctx: ToolContext): Tool;
export const KB_SEARCH_DESCRIPTION: string;
```

Mục catalog:
```ts
{
  key: "kb_search",
  label: "Tra kho tri thức",
  description: "Tra tài liệu do chủ bot nạp lên (chính sách, bảng giá, hướng dẫn)",
  group: "read",
  hasSettings: false,
  available: (ctx) => nguonCuaAgent(ctx.agent.id).length > 0,
  unavailableHint: "Chưa bật nguồn nào cho agent này - vào tab Kho tri thức để gán",
  build: (ctx) => createKbSearchTool(ctx),
}
```

### Phải MỞ RỘNG chữ ký `available` trước

Đã kiểm ngày 08/08/2026: `tool-catalog-types.ts:82` khai
`available?: () => boolean` - **không nhận ngữ cảnh**. `read_image` chỉ cần hỏi
"sidecar đã cấu hình chưa" nên không cần agent nào; `kb_search` thì phải biết
đang dựng tool cho AGENT NÀO.

Đổi thành:

```ts
available?: (scope: { agent: AgentProfile; account: Pick<AccountConfig, "disabledTools"> }) => boolean;
```

`tool-registry.ts:75` (`return !def.available || def.available()`) đã có sẵn
biến `scope` trong `listAvailableTools` - chỉ việc truyền xuống.

**Chỗ dễ sai:** `listAvailableTools` được gọi từ HAI nơi - `buildAgentTools`
(dựng schema thật) và `persona-prompt.ts` (dựng mục "Khả năng"). Hai nơi phải
cùng thấy một danh sách; lệch nhau thì persona khoe tool mà model không hề
nhận được - đúng lớp bug đã có test bất biến canh ở `persona-prompt.test.ts`.
`read_image` giữ nguyên `available: () => ...` (bỏ qua tham số) nên không phải
sửa.

## Tham số vào trang Cấu hình

| Key | Mặc định | Min-Max | Nhãn |
|---|---|---|---|
| `KB_MAX_RESULT_CHARS` | 4000 | 500-20000 | Trần ký tự cho kết quả tra kho |

Trần này áp cho TOÀN BỘ chuỗi kết quả tool (đã gồm thẻ bọc và tên nguồn), không
phải cho từng đoạn.

## Hình dạng schema đầu vào

```ts
z.object({
  cau_hoi: z.string().min(1).describe("Câu hỏi hoặc từ khóa cần tra, viết bằng tiếng Việt tự nhiên"),
})
```

**Gốc phải là `z.object` phẳng** - luật đã có ở
`tool-schema-provider-compat.test.ts` (union ở nút gốc làm DeepSeek chối cả
request). Bộ quét sẽ tự bắt tool mới này vì nó quét cả catalog.

## Các bước

- [ ] **B1: Test tool trả về nội dung có bọc thẻ (đỏ trước)**

```ts
it("kết quả bọc trong thẻ nội dung ngoài", async () => {
  const kq = await chay(ctx, { cau_hoi: "bảo hành" });
  assert.match(kq, new RegExp(`<${THE_NOI_DUNG_NGOAI}>`));
  assert.match(kq, new RegExp(`</${THE_NOI_DUNG_NGOAI}>`));
});

it("mỗi đoạn kèm TÊN NGUỒN để model dẫn nguồn cho khách", async () => {
  const kq = await chay(ctx, { cau_hoi: "bảo hành" });
  assert.match(kq, /Chính sách bảo hành/);
});
```

- [ ] **B2: Test nhánh rỗng và nhánh hỏng**

```ts
it("không tìm thấy gì thì trả ketQuaLoi, KHÔNG trả chuỗi rỗng", async () => {
  const kq = await chay(ctx, { cau_hoi: "xyzzy khong co trong tai lieu nao" });
  assert.match(loiCuaTool(kq), /không tìm thấy/i);
});

it("lỗi SQL thật (bảng bị DROP) trả câu cho model đọc, KHÔNG ném ra agent loop", async () => {
  database.db.exec("DROP TABLE kb_chunks_fts");
  const kq = await chay(ctx, { cau_hoi: "bảo hành" });
  assert.match(loiCuaTool(kq).toLowerCase(), /no such table/);
});
```

Ca DROP TABLE phải nằm ở **file test riêng, cô lập hẳn** - đúng mẫu
`schedule-task-tool-sql-error.test.ts` (mỗi file test là một process, DB tạm
riêng nên phá bảng không ảnh hưởng file khác).

- [ ] **B3: Test trần ký tự**

```ts
it("kết quả bị cắt về đúng trần ký tự, có câu báo đã cắt", async () => {
  tuning.setTuning("KB_MAX_RESULT_CHARS", 200);
  const kq = await chay(ctx, { cau_hoi: "bảo hành" });
  assert.ok(kq.length < 400, `dài ${kq.length}, trần 200 cộng phần vỏ`);
  assert.match(kq, /đã rút gọn/i);
});
```

- [ ] **B4: Test cách ly theo agent ở TẦNG TOOL**

```ts
it("tool chỉ trả nguồn đã bật cho agent trong ctx", async () => {
  binding.datNguonChoAgent("agent-a", [nguonA.id]);
  const kq = await chay(ctxCuaAgentA, { cau_hoi: "bảo hành" });
  assert.doesNotMatch(kq, /nội dung riêng của nguồn B/);
});
```

- [ ] **B5: Test tool VẮNG MẶT khi agent chưa gán nguồn**

```ts
it("agent chưa gán nguồn nào thì kb_search không vào schema", () => {
  const tools = registry.buildAgentTools(ctxChuaGan);
  assert.equal("kb_search" in tools, false);
});

it("gán rồi thì có mặt", () => {
  binding.datNguonChoAgent(AGENT, [nguon.id]);
  assert.equal("kb_search" in registry.buildAgentTools(ctx), true);
});
```

- [ ] **B6: Luật persona**

Thêm vào `persona-tool-rules.ts` (KHÔNG thêm vào `BASE_PERSONA` - luật của tool
phải biến mất khi tool tắt, đã có test bất biến canh chuyện này):

```
- Câu hỏi về chính sách, bảng giá, quy trình, hướng dẫn của chỗ mình thì TRA
  kho tri thức trước, đừng trả lời bằng trí nhớ chung.
- Trả lời DỰA TRÊN đoạn tra được, và nói rõ lấy từ tài liệu nào.
- Tra không ra thì nói thật là chưa có trong tài liệu, TUYỆT ĐỐI không bịa số
  liệu, giá, hay thời hạn.
```

- [ ] **B7: `pnpm typecheck` + `pnpm test`**

Bộ quét `tool-schema-provider-compat.test.ts` phải tự động phủ tool mới. Kiểm
số tool trong khẳng định `ds.length >= 13` - nâng lên 14.

- [ ] **B8: Phá code kiểm 6 chốt**

| Phá gì | Test phải đỏ |
|---|---|
| Bỏ thẻ `<noi_dung_ngoai>` | "bọc trong thẻ nội dung ngoài" |
| Không kèm tên nguồn | "kèm TÊN NGUỒN" |
| Nhánh rỗng trả chuỗi trơn thay vì `ketQuaLoi` | "KHÔNG trả chuỗi rỗng" |
| Bỏ try/catch, để lỗi SQL ném ra | "KHÔNG ném ra agent loop" |
| Bỏ trần ký tự | "cắt về đúng trần" |
| `available()` luôn trả true | "chưa gán nguồn thì không vào schema" |

- [ ] **B9: Commit**

```
feat(kb): tool kb_search cho bot tra tài liệu đã nạp
```

## Định nghĩa hoàn thành

- Tool có mặt đúng lúc, vắng đúng lúc.
- Mọi nhánh hỏng đi qua `ketQuaLoi`, không nhánh nào ném ra agent loop.
- Kết quả bọc thẻ, kèm tên nguồn, tôn trọng trần ký tự.
- Bộ quét schema nhà cung cấp xanh với 14 tool.
- 6/6 phép phá đỏ đúng chỗ.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Nội dung tài liệu chứa chỉ thị -> model làm theo | Bọc `<noi_dung_ngoai>`, persona đã có luật cho thẻ này |
| Model bịa số liệu khi tra không ra | Luật persona B6 + nhánh rỗng trả `ketQuaLoi` (model đọc ra là hỏng, không phải là "không có gì") |
| Schema gốc không phải object -> nhà cung cấp chối cả request | Bộ quét sẵn có, chỉ cần nâng số đếm |
| Tool luôn có mặt rồi luôn trả rỗng | `available()` theo nguồn đã gán |

## Bước tiếp

Phase 05 cho người vận hành nạp nguồn và bật cho agent.
