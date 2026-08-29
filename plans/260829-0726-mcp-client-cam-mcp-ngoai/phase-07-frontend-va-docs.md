# Phase 07: Dashboard frontend + docs

**Plan:** [plan.md](plan.md) | **Spec:** [reports/thiet-ke-va-interface.md](reports/thiet-ke-va-interface.md)
**Deliverable:** Tab "MCP" trên dashboard: liệt kê server (trạng thái + số tool + số agent gán), thêm/sửa/xóa server, test kết nối, gán agent (default-deny), duyệt-lại khi drift; docs cập nhật.
**Phụ thuộc:** Phase 06 (API `/api/mcp/*`).

## Bối cảnh

- Frontend khó TDD tất định -> phần lớn nghiệm thu THỦ CÔNG (mở dashboard thao tác) + cổng tĩnh `pnpm typecheck -p web` và `pnpm build:web`. Chỉ file logic thuần (không JSX) mới viết unit test (mẫu `web/src/pages/kb-*.test.ts`).
- KHUÔN MẪU sao chép trực tiếp (tab Kho tri thức đã có, cùng dạng "danh sách + gán agent"):
  - `web/src/pages/knowledge-page.tsx` -> `web/src/pages/mcp-page.tsx`
  - `web/src/pages/kb-source-row.tsx` -> `web/src/pages/mcp-server-row.tsx`
  - `web/src/pages/kb-add-source-modal.tsx` -> `web/src/pages/mcp-server-form-modal.tsx`
  - `web/src/pages/kb-assign-agents-modal.tsx` -> `web/src/pages/mcp-assign-agents-modal.tsx`
- Dùng lại shared có sẵn: `web/src/shared/secret-input.tsx` (ô header bí mật, quy ước "trống = giữ key cũ" + nút xóa riêng), `web/src/shared/confirm-dialog.tsx` (xóa server), `web/src/shared/ui-bits.tsx`, `web/src/shared/dashboard-icons.tsx`.
- Router + điều hướng: `web/src/main.tsx` (react-router). Thêm route `/mcp` + mục nav cạnh "Kho tri thức".
- Mỗi file JSX < 200 dòng - tách modal/row/section như tab KB đã tách.

## Task 1: Trang MCP + dòng server + form thêm/sửa

**Files:**
- Create: `web/src/pages/mcp-page.tsx`, `web/src/pages/mcp-server-row.tsx`, `web/src/pages/mcp-server-form-modal.tsx`
- Create (logic thuần + test): `web/src/pages/mcp-status-label.ts`, `web/src/pages/mcp-status-label.test.ts`
- Modify: `web/src/main.tsx` (route + nav)

**Interfaces:**
- Consumes API (Phase 06): `GET /api/mcp` -> danh sách (mỗi phần tử có `hasHeaders`, `soAgentGan`, `runtime`); `POST /api/mcp` `{ten,url,headers?}`; `PATCH /api/mcp/:id`; `DELETE /api/mcp/:id`; `DELETE /api/mcp/:id/headers`. (Trạng thái kết nối hiện qua BADGE sau khi Lưu - POST/PATCH tự nối lại - nên V1 KHÔNG cần endpoint `/test` riêng.)
- `McpServerView` (spec 3): `{id,ten,url,enabled,trangThai,loi,toolsSnapshot,hasHeaders,soAgentGan}`.

- [ ] **Step 1: viết test đỏ cho hàm nhãn trạng thái (logic thuần)**

```ts
// web/src/pages/mcp-status-label.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nhanTrangThai } from "./mcp-status-label.js";

describe("nhanTrangThai", () => {
  it("map đủ 4 trạng thái sang chữ + tông màu", () => {
    assert.equal(nhanTrangThai("da_ket_noi").chu, "Đã kết nối");
    assert.equal(nhanTrangThai("loi").tone, "warn");
    assert.equal(nhanTrangThai("can_duyet_lai").chu, "Chờ duyệt lại");
    assert.equal(nhanTrangThai("cho_ket_noi").tone, "muted");
  });
});
```

- [ ] **Step 2: chạy thấy đỏ** — Run: `npx tsx --test web/src/pages/mcp-status-label.test.ts` — Expected: FAIL (module chưa có).

- [ ] **Step 3: viết `mcp-status-label.ts`**

```ts
// web/src/pages/mcp-status-label.ts
import type { TrangThaiServer } from "../../../src/mcp/mcp-types.js";

export function nhanTrangThai(t: TrangThaiServer): { chu: string; tone: "ok" | "warn" | "muted" } {
  switch (t) {
    case "da_ket_noi": return { chu: "Đã kết nối", tone: "ok" };
    case "loi": return { chu: "Lỗi", tone: "warn" };
    case "can_duyet_lai": return { chu: "Chờ duyệt lại", tone: "warn" };
    default: return { chu: "Chờ kết nối", tone: "muted" };
  }
}
```

- [ ] **Step 4: chạy thấy xanh** — Run: `npx tsx --test web/src/pages/mcp-status-label.test.ts` — PASS.

- [ ] **Step 5: dựng UI (sao khuôn tab KB)**

Tạo `mcp-page.tsx` (fetch `GET /api/mcp`, render danh sách `mcp-server-row.tsx`, nút "Thêm server" mở `mcp-server-form-modal.tsx`), `mcp-server-row.tsx` (tên + url + badge `nhanTrangThai` + `soTool` tool + `soAgentGan` agent + nút Sửa/Xóa/Gán agent; nếu `trangThai==='can_duyet_lai'` hiện nút "Duyệt lại"), `mcp-server-form-modal.tsx` (ô tên, url; headers dùng `secret-input.tsx` với quy ước "trống = giữ" + nút xóa gọi `DELETE /api/mcp/:id/headers`). Thêm route `/mcp` + mục nav trong `main.tsx`.

- [ ] **Step 6: nghiệm thu thủ công + cổng tĩnh**

Run: `pnpm typecheck -p web` và `pnpm build:web` -> PASS.
Thủ công (mở dashboard): thêm 1 server HTTP thật (vd một MCP server công khai) -> badge chuyển `Đã kết nối` + số tool > 0; nhập url/header sai rồi Lưu -> badge chuyển `Lỗi` (nối lại thất bại); xóa server -> biến mất; xóa header -> nút xóa header ẩn (`hasHeaders` về false).

- [ ] **Step 7: commit**

```bash
git add web/src/pages/mcp-*.tsx web/src/pages/mcp-status-label.* web/src/main.tsx
git commit -m "feat(mcp): tab dashboard quan ly server MCP"
```

## Task 2: Gán agent (default-deny) + duyệt lại drift

**Files:** Create: `web/src/pages/mcp-assign-agents-modal.tsx`; Modify: `web/src/pages/mcp-server-row.tsx`

**Interfaces:** Consumes: `GET /api/agents` (danh sách agent), `GET/PUT /api/mcp/:id/agents`, `POST /api/mcp/:id/duyet-lai` (tên route khớp Phase 06).

- [ ] **Step 1: dựng modal gán agent** (sao `kb-assign-agents-modal.tsx`)

Checkbox liệt kê agent (`GET /api/agents` -> `{id,name,icon}`), tick agent nào được server này; MẶC ĐỊNH không tick cái nào (default-deny). Lưu qua `PUT /api/mcp/:id/agents` `{agentIds}`. Mở từ nút "Gán agent" ở `mcp-server-row.tsx`.

- [ ] **Step 2: nút "Duyệt lại" khi drift**

Ở `mcp-server-row.tsx`, khi `trangThai==='can_duyet_lai'`: hiện cảnh báo ngắn ("Bộ tool của server đã đổi so với lần duyệt trước") + nút "Duyệt lại" gọi `POST /api/mcp/:id/duyet-lai`, xong refetch danh sách.

- [ ] **Step 3: nghiệm thu thủ công**

Run: `pnpm typecheck -p web` -> PASS.
Thủ công: gán server cho 1 agent -> `soAgentGan` tăng; chat với agent ĐÓ và yêu cầu dùng tool ngoài -> bot gọi được; chat với agent CHƯA gán -> bot không có tool đó. (Bước sau cùng nghiệm thu xuyên suốt Phase 05.)

- [ ] **Step 4: commit**

```bash
git add web/src/pages/mcp-assign-agents-modal.tsx web/src/pages/mcp-server-row.tsx
git commit -m "feat(mcp): gan agent cho server + duyet lai drift tren dashboard"
```

## Task 3: Cập nhật tài liệu

**Files:** Modify: `docs/system-architecture.md`, `docs/project-changelog.md`, `docs/project-roadmap.md`

- [ ] **Step 1: `system-architecture.md`** — thêm một mục "MCP client" mô tả: bot làm client nối RA server ngoài (HTTP-only), tool ngoài chảy qua `tool-registry` nên thừa hưởng mọi bộ lọc; gán per-agent default-deny; kết quả bọc `<noi_dung_ngoai>`; fingerprint drift. Trỏ sơ đồ `docs/mcp-client-architecture.html`.

- [ ] **Step 2: `project-changelog.md`** — một mục theo mẫu có sẵn: "MCP client: cắm MCP server ngoài, agent tự dùng tool; default-deny per-agent; drift detection".

- [ ] **Step 3: `project-roadmap.md`** — đổi dòng MCP (đã sửa hướng client) sang trạng thái "đang làm"/"xong" tùy tiến độ khi merge.

- [ ] **Step 4: commit**

```bash
git add docs/system-architecture.md docs/project-changelog.md docs/project-roadmap.md
git commit -m "docs(mcp): ghi kien truc MCP client vao tai lieu"
```

(Lưu ý luật repo: KHÔNG dùng `chore`/`docs` cho thay đổi trong `.claude/` - đây là `docs/` của project nên `docs(...)` hợp lệ.)

## Success Criteria

- [ ] Tab MCP: thêm/sửa/xóa server, test kết nối, badge trạng thái đúng; header nhập qua `secret-input` + xóa riêng.
- [ ] Gán agent mặc định không tick (default-deny); gán xong `soAgentGan` phản ánh đúng.
- [ ] `can_duyet_lai` hiện nút "Duyệt lại", bấm xong trạng thái về `da_ket_noi`.
- [ ] `pnpm typecheck -p web` + `pnpm build:web` sạch.
- [ ] Nghiệm thu xuyên suốt: agent ĐƯỢC gán dùng được tool ngoài; agent CHƯA gán thì không.
- [ ] Docs cập nhật (kiến trúc + changelog + roadmap).
```
