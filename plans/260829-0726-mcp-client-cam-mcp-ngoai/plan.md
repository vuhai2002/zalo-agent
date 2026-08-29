# Kế hoạch: MCP client - cắm MCP server ngoài vào zalo-agent

> **Cho người thực thi:** dùng superpowers:subagent-driven-development (khuyến nghị) hoặc superpowers:executing-plans để chạy từng task. Các bước dùng checkbox `- [ ]` để theo dõi.

**Goal:** Cho agent loop của bot dùng được tool từ các MCP server bên ngoài (chỉ HTTP), gán theo từng agent (mặc định TẮT), kết quả tool ngoài bọc như nội dung không tin cậy, phát hiện server đổi tool ngầm.

**Architecture:** Module mới `src/mcp/` giữ kết nối tới các server ngoài (sống lâu, tạo 1 lần/server), khám phá tool, cache. Mỗi tool ngoài được bọc thành một `ToolDefinition` rồi CHẢY QUA đúng bộ lọc của `tool-registry.ts` (tắt theo agent/account, loại khỏi lượt lịch) - không đi đường tắt, nên thừa hưởng mọi hàng rào sẵn có. Quản lý qua tab dashboard + DB, soi khuôn Kho tri thức.

**Tech Stack:** TypeScript ESM, `@ai-sdk/mcp` (client MCP, transport HTTP), Vercel AI SDK v7 (`streamText`), `node:sqlite`, Hono (dashboard), Zod v4, node:test.

**Spec:** `plans/260829-0726-mcp-client-cam-mcp-ngoai/reports/thiet-ke-va-interface.md` (quyết định + chữ ký module). Sơ đồ kiến trúc: `docs/mcp-client-architecture.html`.

## Global Constraints (copy verbatim vào mọi task)

- **Chỉ transport HTTP.** KHÔNG stdio - bot hạn chế chạy lệnh trên VPS (quyết định của người dùng).
- **Default-deny theo agent.** Agent chưa gán server nào thì không thấy tool ngoài nào. Bảng `agent_mcp_servers`, soi `agent_kb_sources`.
- **Tool ngoài KHÔNG đi đường tắt** - phải thành `ToolDefinition` và qua `listAvailableTools`.
- **Kết quả tool ngoài bọc `wrapUntrustedContent`; nhánh hỏng trả `ketQuaLoi`, không ném.**
- **Mọi tool ngoài mặc định `group: "action"` + `runsInScheduledTurn: false`** (annotation `readOnlyHint` của server chỉ để hiển thị, không dùng cho quyết định bảo mật).
- **File < 200 dòng, kebab-case, tên tự mô tả. Chuỗi tiếng Việt giữ dấu, dấu câu ASCII.**
- **Env mới: schema Zod trong `env.ts` kèm `.default()`; tham số chỉnh nóng vào `tuning-definitions.ts`.**
- **Test: sửa file nào chạy đúng file test đó; full suite 1 lần ở cuối. Không tự sinh tải giả.**
- **Secret (header auth) mã hóa AES-256-GCM bằng helper sẵn có; có đường XÓA riêng ("ô trống = giữ key cũ").**
- **Không tự commit/push. Không tự chạy `db:push`.**

## Phases

| # | Phase | Deliverable kiểm được | Trạng thái |
|---|---|---|---|
| 01 | [Phụ thuộc + config + lược đồ DB](phase-01-phu-thuoc-va-luoc-do.md) | `@ai-sdk/mcp` cài xong, typecheck sạch; config `MCP_*` (env+tuning); hai bảng `mcp_servers`+`agent_mcp_servers` tạo được | [x] Xong (e1dfc50) |
| 02 | [Store + gán per-agent](phase-02-store-va-binding.md) | CRUD server (header mã hóa) + gán/dọn theo agent (default-deny) | [x] Xong (d6d7581) |
| 03 | [ToolDefinition + drift](phase-03-tool-definition-va-drift.md) | 1 tool MCP thành ToolDefinition có canh: namespace, available theo gán, bọc kết quả, ketQuaLoi, recheck; fingerprint drift | [x] Xong (2b749ae) |
| 04 | [Kết nối + manager](phase-04-ket-noi-va-manager.md) | Nối 1 server HTTP giả, khám phá tool, dựng def qua Phase 03, health/reconnect, cache | [x] Xong (54315c9) |
| 05 | [Ghép vào agent loop](phase-05-ghep-agent-loop.md) | `buildAgentTools` gộp tool ngoài; chỉ hiện cho agent được gán; tôn trọng disable/isolated | [x] Xong (215d4c8) |
| 06 | [Dashboard backend + lifecycle](phase-06-dashboard-backend.md) | `/api/mcp` (CRUD, gán, trạng thái, test-connect, duyệt-lại drift); manager start ở boot; dọn khi xóa agent/account | [x] Xong (4abf20d) |
| 07 | [Dashboard frontend + docs](phase-07-frontend-va-docs.md) | Tab React quản server + gán agent + duyệt-lại drift; cập nhật docs | [x] Xong (fd4f126) |

## Thứ tự phụ thuộc

- 01 -> 02 -> 03 -> 04 -> 05 là chuỗi cứng (mỗi phase dựng trên type/hàm của phase trước).
- 06 cần 02 (store) + 04 (manager). 07 cần 06 (API).
- Phase 05 là chỗ tool ngoài THẬT SỰ tới model - trước đó chưa có tác dụng quan sát được ngoài test.

## Rủi ro chính (chi tiết ở spec)

- Lệch version `@ai-sdk/mcp` vs `ai` làm vỡ typecheck (kiểu `Tool` qua `provider-utils`) - Phase 01 xử.
- `listAvailableTools` đang đồng bộ; `mcpToolDefinitions(agentId)` phải là tra cache đồng bộ trong RAM - Phase 03/05.
- Tránh vòng import `tool-registry.ts` <-> `src/mcp/` - spec chốt chiều phụ thuộc.
