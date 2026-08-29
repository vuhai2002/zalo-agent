# Spec: MCP client - thiết kế + hợp đồng interface

Tài liệu này khóa mọi quyết định + chữ ký hàm để 7 file phase không phải đoán gì.
Sơ đồ kiến trúc cho người mới: `docs/mcp-client-architecture.html`.

## 1. Quyết định đã chốt (từ hội thoại brainstorm)

- **Hướng: bot là MCP _client_** - nối RA các server ngoài, dùng tool của chúng. Không phải server.
- **Chỉ transport HTTP** (Streamable HTTP). KHÔNG stdio - bot hạn chế chạy lệnh trên VPS.
- **Quyền tool: đọc + ghi, kiểm soát theo agent.** Mặc định TẮT, gán theo từng agent. Tool ghi xếp `action` + loại khỏi lượt lịch.
- **Quản lý: tab dashboard đầy đủ + DB.**
- **V1 làm luôn fingerprint drift** (chống server đổi tool ngầm).
- **Bảng riêng** `mcp_servers` + `agent_mcp_servers` (không dùng `runtime_settings` - dữ liệu nhiều dòng). **Assignment khóa theo `agent_id`** (mirror `agent_kb_sources`).
- **Lib: `@ai-sdk/mcp`** (client tách khỏi `ai`; `createMCPClient`, transport HTTP native). Raw `@modelcontextprotocol/sdk` KHÔNG cần (tools-only, không cần notification).

## 2. Data model (bảng riêng, không FK - dọn tay trong giao dịch)

`src/mcp/mcp-schema.ts` export `taoBangMcp(db: DatabaseSync): void`, gọi trong
`database.ts runMigrations()` NGAY SAU `taoBangFriendRequests(db)` (dòng 251).

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id             TEXT PRIMARY KEY,            -- randomBytes(8).hex (như kb_sources, tránh hồi sinh theo slug)
  ten            TEXT NOT NULL,
  url            TEXT NOT NULL,               -- Streamable HTTP endpoint
  headers_ma_hoa TEXT NOT NULL DEFAULT '',    -- encryptSecret(JSON.stringify(headers)); '' = không header
  enabled        INTEGER NOT NULL DEFAULT 1,
  trang_thai     TEXT NOT NULL DEFAULT 'cho_ket_noi'
                 CHECK (trang_thai IN ('cho_ket_noi','da_ket_noi','loi','can_duyet_lai')),
  loi            TEXT NOT NULL DEFAULT '',
  tools_snapshot TEXT NOT NULL DEFAULT '',    -- JSON McpToolInfo[]: {ten,moTa} - hiển thị + đối chiếu drift
  fingerprint    TEXT NOT NULL DEFAULT '',    -- JSON Record<string,string> mốc đã duyệt (fingerprintTools)
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS agent_mcp_servers (
  agent_id  TEXT NOT NULL,
  server_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, server_id)
);
```

Không có cột `transport` (YAGNI - HTTP-only là ràng buộc cứng). Thêm sau bằng
`addColumnIfMissing` nếu cần.

## 3. Hợp đồng interface (mọi symbol mới, khóa chữ ký)

### `src/mcp/mcp-types.ts` (type dùng chung, tránh vòng import)
```ts
export type TrangThaiServer = "cho_ket_noi" | "da_ket_noi" | "loi" | "can_duyet_lai";
export type McpToolInfo = { ten: string; moTa: string };
export type McpServer = {                    // view nội bộ KHÔNG kèm giá trị headers, chỉ cờ hasHeaders
  id: string; ten: string; url: string; enabled: boolean;
  trangThai: TrangThaiServer; loi: string; toolsSnapshot: McpToolInfo[];
  hasHeaders: boolean; createdAt: string; updatedAt: string;
};
export type McpServerNoiBo = McpServer & { headers: Record<string, string> };  // có headers giải mã - cho manager
export type McpServerView = {                // cho API dashboard (che secret)
  id: string; ten: string; url: string; enabled: boolean;
  trangThai: TrangThaiServer; loi: string; toolsSnapshot: McpToolInfo[];
  hasHeaders: boolean; soAgentGan: number;
};
```

### `src/mcp/mcp-schema.ts`
```ts
export function taoBangMcp(db: DatabaseSync): void;
```

### `src/mcp/mcp-server-store.ts` (mirror `kb-source-store.ts`)
```ts
export function taoServer(p: { ten: string; url: string; headers?: Record<string,string>; enabled?: boolean }): McpServer;
export function layServerNoiBo(id: string): McpServerNoiBo | null;   // headers GIẢI MÃ - chỉ manager gọi
export function danhSachServer(): McpServer[];                        // KHÔNG headers
export function capNhatServer(id: string, patch: { ten?: string; url?: string; headers?: Record<string,string>; enabled?: boolean }): void;  // headers===undefined => giữ nguyên
export function xoaHeaders(id: string): void;                         // đường XÓA header riêng ("ô trống = giữ")
export function xoaServer(id: string): void;                          // trongGiaoDich: xóa agent_mcp_servers rồi mcp_servers
export function datTrangThaiServer(id: string, trangThai: TrangThaiServer, loi?: string): void;
export function luuSnapshotFingerprint(id: string, snapshot: McpToolInfo[], fingerprintJson: string): void;
export function layFingerprint(id: string): string;                  // '' nếu chưa có mốc
```
- id sinh bằng `randomBytes(8).toString("hex")`.
- headers lưu `encryptSecret(JSON.stringify(headers))`; đọc `JSON.parse(decryptSecret(...))` với try/catch rơi về `{}` (như `getBraveApiKey`).
- `danhSachServer` map row KHÔNG kèm headers; `layServerNoiBo` kèm headers giải mã.

### `src/mcp/mcp-agent-binding.ts` (SAO Y `kb-agent-binding.ts`)
```ts
export function serversCuaAgent(agentId: string): string[];          // default-deny: rỗng = không được server nào
export function agentCuaServer(serverId: string): string[];
export function datServerChoAgent(agentId: string, serverIds: string[]): void;   // THAY THẾ
export function datAgentChoServer(serverId: string, agentIds: string[]): void;   // THAY THẾ
export function demAgentTheoServer(): Map<string, number>;
export function xoaGanServerCuaAgent(agentId: string): void;         // gọi từ deleteAgent
```

### `src/mcp/mcp-client-connect.ts` (bọc `@ai-sdk/mcp`)
```ts
export type KetNoiMcp = { tools(): Promise<Record<string, Tool>>; close(): Promise<void> };
export type LoiKetNoiMcp = Error & { loaiLoi: "ket_noi" };
export async function ketNoiServer(cfg: { url: string; headers: Record<string,string>; connectTimeoutMs: number }): Promise<KetNoiMcp>;
```
- Dùng `createMCPClient({ transport: { type: "http", url, headers } })`. `redirect` để mặc định `'error'` (chống SSRF-qua-redirect).
- Bọc `Promise.race` timeout `connectTimeoutMs`; lỗi ném ra là `LoiKetNoiMcp` (không để lỗi thô rò requestBody).

### `src/mcp/mcp-tool-drift.ts` (dùng `fingerprintTools`/`detectToolDrift` của `ai`)
```ts
export async function chupFingerprint(tools: Record<string, Tool>): Promise<string>;  // JSON.stringify(await fingerprintTools(tools))
export async function soDrift(tools: Record<string, Tool>, mocJson: string): Promise<{ drift: boolean; them: string[]; doi: string[]; bo: string[] }>;
```
- `soDrift`: current = `await fingerprintTools(tools)`; baseline = `JSON.parse(mocJson)`; `detectToolDrift(current, baseline)` -> `{added,removed,changed}`; `drift = added.length+removed.length+changed.length > 0`.
- mốc rỗng (`''`) => `drift:false` (chưa có mốc thì không coi là drift).

### `src/mcp/mcp-tool-definition.ts` (đổi 1 tool MCP -> ToolDefinition có canh)
```ts
export function taoToolDefinitionMcp(p: {
  serverId: string; serverTen: string; toolTen: string; moTa: string;
  aiTool: Tool;                                   // tool gốc từ client.tools()[toolTen]
  toolCallTimeoutMs: number;
  kiemGan: (agentId: string) => boolean;          // TIÊM (để test lõi không cần DB); manager truyền (a) => serversCuaAgent(a).includes(serverId)
}): ToolDefinition;
export function tenToolMcp(serverTen: string, toolTen: string): string;   // "mcp__<slug>__<tool>" (+hash nếu chuẩn hóa mất mát)
export function trichVanBanKetQuaMcp(raw: unknown): string;               // string->dùng; {content:[...]}->ghép text; khác->JSON.stringify
```
ToolDefinition sinh ra:
- `key = tenToolMcp(serverTen, toolTen)`; `label = "<serverTen>: <toolTen>"`; `description = moTa`.
- `group = "action"` (hằng); `runsInScheduledTurn = false`; `keTrongKhaNang = false`.
- `available = (scope) => kiemGan(scope.agent.id)` (cửa 1: default-deny; manager tiêm `kiemGan = (a) => serversCuaAgent(a).includes(serverId)`).
- `build = (ctx) => tool({ description: moTa, inputSchema: aiTool.inputSchema, execute })` với `execute`:
  1. Cửa 2 (recheck fail-closed): `if (!kiemGan(ctx.agent.id)) return ketQuaLoi("Tool ngoài không còn được cấp cho agent này")`.
  2. `try { const raw = await goiCoTimeout(() => aiTool.execute!(args, opts), toolCallTimeoutMs); return wrapUntrustedContent(trichVanBanKetQuaMcp(raw), \`MCP <serverTen>/<toolTen>\`); }`
  3. `catch (e) { return ketQuaLoi(\`Tool ngoài "<toolTen>" lỗi: <thongDiep>\`); }`
- KHÔNG bao giờ ném. `goiCoTimeout` là helper nội bộ nhỏ (Promise.race + clearTimeout).

### `src/mcp/mcp-manager.ts` (giữ kết nối + cache tool + expose cho registry)
```ts
export function mcpToolDefinitions(agentId: string): ToolDefinition[];   // ĐỒNG BỘ, đọc cache RAM: server ĐÃ NỐI và ĐÃ GÁN cho agentId
export function trangThaiCacServer(): { serverId: string; trangThai: TrangThaiServer; soTool: number; loi: string }[];
export async function ketNoiLaiServer(serverId: string): Promise<void>;  // (re)connect 1 server: gọi khi thêm/bật, có discovery + drift check
export async function ngatServer(serverId: string): Promise<void>;        // đóng client (khi xóa/tắt)
export async function duyetLaiDrift(serverId: string): Promise<void>;     // lấy fingerprint hiện tại làm mốc mới + set trang_thai='da_ket_noi'
export function startMcpManager(): () => void;                            // nối mọi server enabled + vòng health; trả stop fn
```
- State nội bộ: `Map<serverId, { ketNoi: KetNoiMcp; tools: { toolTen; moTa; def: ToolDefinition }[]; trangThai }>`.
- `mcpToolDefinitions(agentId)`: `serversCuaAgent(agentId)` (sync) giao với các server đang NỐI trong map; trả `def` đã dựng sẵn của chúng. Rỗng khi manager chưa chạy -> an toàn cho test cũ.
- `ketNoiLaiServer`: `layServerNoiBo` -> `ketNoiServer` -> `tools()` -> dựng def qua `taoToolDefinitionMcp` -> `soDrift` với mốc DB: có drift & có mốc -> `datTrangThaiServer('can_duyet_lai')` + KHÔNG nạp tool; không drift/chưa mốc -> `luuSnapshotFingerprint` (nếu chưa mốc) + `datTrangThaiServer('da_ket_noi')` + nạp tool vào map. Lỗi nối -> `datTrangThaiServer('loi', msg)`.
- `startMcpManager`: lặp `danhSachServer().filter(enabled)` gọi `ketNoiLaiServer` (bọc try/catch, 1 server hỏng không chặn cái khác, KHÔNG chặn boot); `setInterval` health mỗi `MCP_HEALTH_INTERVAL_MS`, `timer.unref()`; trả `() => { clearInterval; đóng mọi client }`.

## 4. Điểm ghép (file:line xác nhận từ codebase)

| Chỗ sửa | File:line | Việc |
|---|---|---|
| Đăng ký migration | `conversation/database.ts:251` | Thêm `taoBangMcp(db);` sau `taoBangFriendRequests(db);` |
| Import helper mã hóa | `config/secret-cipher.ts` | `import { encryptSecret, decryptSecret, maskSecret } from "../config/secret-cipher.js"` |
| DB + giao dịch | `conversation/database.ts:10`, `shared/db-transaction.ts:28` | `import { db }`, `import { trongGiaoDich }` |
| Gộp tool ngoài | `agent/tools/tool-registry.ts:69` + `mcp-tool-provider.ts` (mới) | `listAvailableTools` lọc trên `[...TOOL_DEFINITIONS, ...layToolMcpChoAgent(scope.agent.id)]`; provider THUẦN (không chạm DB) tránh mở SQLite ở module scope; manager gọi `datNguonToolMcp(mcpToolDefinitions)` lúc boot |
| Dọn gán khi xóa agent | `config/agent-store.ts:172` | Trong `trongGiaoDich` của `deleteAgent`, thêm `xoaGanServerCuaAgent(id)` cạnh `xoaGanNguonCuaAgent(id)` |
| Mount route | `server/dashboard-server.ts:176` | `app.route("/api/mcp", mcpRoutes);` (dưới middleware auth dòng 113, trên catch-all dòng 180) |
| Lifecycle boot | `index.ts:84` (quản lý) hoặc `:95` (.then) | `stopMcpManager = startMcpManager();` |
| Lifecycle shutdown | `index.ts:34-52` | thêm `stopMcpManager()`; dùng idiom `let stopMcpManager = () => {}` |

Chiều phụ thuộc (không tạo vòng): `tool-registry.ts -> mcp-tool-provider.ts` (THUẦN); `mcp-manager.ts -> {mcp-tool-provider, mcp-tool-definition, mcp-client-connect, mcp-tool-drift, mcp-server-store, mcp-agent-binding}`; `mcp-tool-definition.ts -> {wrap-untrusted-content, tool-failure-result}`. `src/mcp` phụ thuộc `agent/tools` primitive, KHÔNG chiều ngược. **`tool-registry` KHÔNG import `mcp-manager`** (chỉ provider thuần) - nếu import thẳng sẽ kéo `database.ts` mở SQLite ở module scope và vỡ bẫy test của CLAUDE.md.

## 5. Mô hình bảo mật (đối chiếu goclaw + luật repo)

1. **Default-deny 2 lớp**: cửa 1 `available()` lúc dựng (chưa gán -> tool không vào schema); cửa 2 recheck trong `execute` (fail-closed, phòng gỡ quyền giữa lượt). goclaw enforce đúng 2 chỗ này.
2. **Kết quả không tin cậy**: mọi output server ngoài `wrapUntrustedContent(text, "MCP <ten>")`. Nhánh hỏng `ketQuaLoi(...)` (object `{ok:false}`), KHÔNG ném.
3. **Drift**: mốc `fingerprintTools` lúc duyệt; `detectToolDrift` mỗi lần nối lại; drift -> `can_duyet_lai`, không nạp tool tới khi người duyệt (`duyetLaiDrift`).
4. **group=action + runsInScheduledTurn=false** cho MỌI tool ngoài (annotation `readOnlyHint` của server chỉ hiển thị, không dùng cho quyết định bảo mật - spec MCP dặn).
5. **SSRF nhẹ**: URL do người vận hành nhập (không phải LLM chọn), nên không cần cả bộ `openGuardedRequest`; giữ `redirect:'error'` mặc định + khuyến khích HTTPS.

## 6. Config

Thêm vào `config/env.ts` (Zod, kèm `.default()`) VÀ `config/tuning-definitions.ts` (mỗi key tuning PHẢI trùng tên env - kiểm lúc biên dịch):

| Key | Kiểu | Default | Ý nghĩa |
|---|---|---|---|
| `MCP_ENABLED` | boolean | `true` | Công tắc tổng |
| `MCP_CONNECT_TIMEOUT_MS` | number | `15000` | Trần thời gian nối 1 server |
| `MCP_TOOL_TIMEOUT_MS` | number | `60000` | Trần 1 lần gọi tool ngoài |
| `MCP_HEALTH_INTERVAL_MS` | number | `30000` | Chu kỳ health/nối lại |

KHÔNG thêm vào `.env*.example` (không phải đọc trước lúc mở DB).

## 7. Cách test (harness sẵn có)

- **Store/binding**: `setupTestEnv()` -> `await import()` động module chạm DB; `beforeEach` `DELETE FROM` hai bảng; `database.closeDatabase()` trong `after`. `CREDENTIALS_ENCRYPTION_KEY` đã set sẵn trong test env nên `encryptSecret` chạy.
- **tool-definition**: gọi thẳng `def.build(ctx).execute(args, {})` với `ctx` giả (`fakeAgentProfile`), `aiTool` giả (`{ inputSchema, execute: async()=>... }`). Khẳng định `loiCuaTool(ra)` (shape `{ok:false}`) cho nhánh hỏng, và chuỗi có nhãn `<noi_dung_ngoai_` cho nhánh thành công. Phá-kiểm: bỏ `wrapUntrustedContent` -> test đỏ; bỏ recheck -> test "gỡ quyền giữa lượt" đỏ.
- **registry**: mẫu `tool-registry.test.ts makeContext(...)` + `fakeAgentProfile`; khẳng định `Object.keys(buildAgentTools(ctx))` CÓ/KHÔNG có key `mcp__...` theo gán. Vì `mcpToolDefinitions` đọc cache manager, test tiêm cache qua một cửa test nội bộ hoặc gọi `ketNoiLaiServer` với `ketNoiServer` mock.
- **manager**: mock `ketNoiServer` trả `tools()` cố định; kiểm drift đổi trạng thái `can_duyet_lai`; 1 server hỏng không chặn cái khác.
- **model giả**: `MockLanguageModelV4({ doStream })` + `thanhKetQuaStream` (KHÔNG `doGenerate`).

## 8. Rủi ro + xử

- **Lệch version `@ai-sdk/mcp` vs `ai`** (kiểu `Tool` qua `provider-utils`): Phase 01 cài `@ai-sdk/mcp` + nâng `ai` 7.x cùng lượt, chạy `pnpm typecheck` làm cổng. Nhớ `minimumReleaseAge:1440`.
- **`aiTool.execute` shape kết quả**: `@ai-sdk/mcp` map kết quả MCP; `trichVanBanKetQuaMcp` xử cả 3 dạng (string / {content:[{type:'text',text}]} / khác). Phase 04 có test cho cả 3.
- **`inputSchema` của aiTool** tái dùng trực tiếp khi bọc; nếu SDK đổi cách phơi schema, chỉ sửa `mcp-tool-definition.ts`.
- **`mcpToolDefinitions` gọi mỗi lượt**: chỉ đọc RAM + 1 truy vấn `serversCuaAgent` (sync). Chấp nhận như `available()` của KB.
