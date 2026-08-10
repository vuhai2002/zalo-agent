# Phase 06 - Dashboard

**Ưu tiên:** trung bình cao. Không có lỗ an toàn, nhưng luồng vận hành dẫn người
dùng vào ngõ cụt đúng ở bước quan trọng nhất của tính năng: gán nguồn cho agent.
**Trạng thái:** chưa làm. **Cần:** phase 04 (trang xem đoạn cần breadcrumb đã đúng).

## Bối cảnh

- File: `web/src/pages/agent-detail-page.tsx`, `agent-form-layout.tsx`,
  `agent-tools-section.tsx`, `agent-kb-sources-section.tsx`, `knowledge-page.tsx`,
  `kb-source-row.tsx`, `kb-add-source-modal.tsx`,
  `src/agent/tools/tool-catalog-read.ts`, `src/server/routes/kb-routes.ts`.
- Mẫu trang bảng có ô tìm: `web/src/pages/memory-page.tsx`, `contacts-page.tsx`
  (dùng `ListToolbar`).
- Chốt rời trang: `useUnsavedChangesPrompt` - đã có, khối KB đang đi vòng qua.

## Lỗi phải đóng

| Mã | Lỗi | Người vận hành gặp thế nào |
|---|---|---|
| I17 | Tick nguồn chưa lưu KHÔNG được chốt rời trang bảo vệ | Gạt 3 nguồn, bấm Quay lại -> mất sạch, không hộp thoại nào. Bot sau đó trả lời "không biết" mà không có gì cho biết vì sao |
| I18 | Sau khi lưu nguồn, badge `kb_search` vẫn "chưa cấu hình" tới khi F5; và `unavailableHint` bảo sang tab Kho tri thức để GÁN, mà tab đó không có ô gán nào | Ngõ cụt tròn: subtitle của chính tab đó nói ngược lại ("gán ở trang Agents") |
| I19 | Không có đường sửa nội dung nguồn; Xóa + Tạo lại âm thầm gỡ nguồn khỏi MỌI agent (id mới ngẫu nhiên) | Hộp xác nhận không hề cảnh báo |
| I20 | Modal không nói trần dung lượng, không kiểm cỡ ở client | Chỉ biết trần khi đã thất bại |
| I21 | Không có đường xem lại nội dung đã trích | Bot trả lời sai vì tài liệu cũ thì không biết vì sao; đường duy nhất là trang Trace, phải bật `AGENT_TRACE_ENABLED` và tự đi tìm |

## Chuẩn giao diện của repo (sẽ bị soi)

- Responsive thật, bảng không tràn ngang.
- `cursor-pointer` khi bấm được, `disabled:cursor-not-allowed` khi disabled.
- Control tự dựng theo `web/src/shared/ui-bits.tsx`, không lạc kiểu so với
  `memory-page.tsx` / `schedule-page.tsx`.
- Đủ trạng thái rỗng / đang tải / lỗi.
- Chuỗi tiếng Việt GIỮ NGUYÊN DẤU.

## Nhận định then chốt

**I18 có hai cái sai chồng nhau** - phải sửa cả hai, sửa một cái là vẫn ngõ cụt.
Phần server đã đúng (`dungScope` nhận `agentId`); phần client không gọi lại sau
khi lưu, và câu hướng dẫn chỉ sai đường.

**I19 sửa tối thiểu, không làm đường sửa tại chỗ.** Đường sửa nội dung nguồn ghi
roadmap. Việc phải làm ở phase này là cảnh báo trung thực khi xóa: nói rõ có bao
nhiêu agent đang dùng nguồn này và họ sẽ mất quyền tra.

**I21 làm một trang xem đoạn, phân trang.** Không cần đẹp, cần đúng: người vận
hành phải thấy được bot đọc ra CÁI GÌ từ file họ nạp. Đây cũng là cách duy nhất
họ tự phát hiện lỗi đọc kiểu C1/D/E nếu còn sót.

## File

**Tạo:**
- `web/src/pages/kb-chunks-modal.tsx` - xem đoạn đã cắt của một nguồn
- test cho route mới

**Sửa:**
- `src/server/routes/kb-routes.ts` - `GET /sources/:id/chunks` phân trang;
  `DELETE` trả kèm số agent đang dùng (hoặc thêm `GET /sources/:id/agents`)
- `web/src/pages/agent-kb-sources-section.tsx` - báo dirty lên cha, gọi lại tools
  sau khi lưu
- `web/src/pages/agent-detail-page.tsx` + `agent-form-layout.tsx` - gộp cờ dirty
- `web/src/pages/agent-tools-section.tsx` - nhận tín hiệu refetch
- `src/agent/tools/tool-catalog-read.ts` - sửa `unavailableHint`
- `web/src/pages/kb-add-source-modal.tsx` - hiện trần, chặn sớm ở client
- `web/src/pages/kb-source-row.tsx` - nút xem đoạn; cảnh báo khi xóa
- `web/src/pages/knowledge-page.tsx` - `ListToolbar`; dừng poll khi không còn việc

## Các bước

- [ ] **B1: Test đỏ trước - chốt rời trang phủ cả khối KB**

```tsx
it("gạt nguồn rồi rời trang mà chưa lưu thì bị hỏi lại", async () => {
  // Chốt đã có sẵn cho form agent; khối KB giữ state riêng nên đi vòng qua nó.
  render(<AgentDetailPage />);
  await gatNguon("Bảng giá");
  assert.equal(coHoiTruocKhiRoi(), true, "gạt 3 nguồn rồi bấm Quay lại là mất sạch, không hộp thoại nào");
});

it("lưu xong thì rời trang KHÔNG bị hỏi nữa", async () => {
  await gatNguon("Bảng giá");
  await bamLuuNguon();
  assert.equal(coHoiTruocKhiRoi(), false);
});
```

- [ ] **B2: Test đỏ trước - badge cập nhật sau khi lưu**

```tsx
it("lưu nguồn xong thì badge kb_search đổi sang dùng được, không phải chờ F5", async () => {
  render(<AgentDetailPage />);
  assert.match(nhanCua("kb_search"), /chưa cấu hình/);
  await gatNguon("Bảng giá");
  await bamLuuNguon();
  assert.doesNotMatch(nhanCua("kb_search"), /chưa cấu hình/);
});
```

- [ ] **B3: Test đỏ trước - câu hướng dẫn chỉ đúng đường**

```ts
it("unavailableHint của kb_search không chỉ sang tab không có ô gán", () => {
  const hint = mucCatalog("kb_search").unavailableHint!;
  // Tab Kho tri thức chỉ NẠP tài liệu; ô gán nằm ở trang sửa agent. Subtitle
  // của chính tab đó cũng nói vậy - hai chỗ đang mâu thuẫn nhau.
  assert.doesNotMatch(hint, /tab Kho tri thức để.*gán/i);
  assert.match(hint, /ngay bên dưới|trang Agents|khối Kho tri thức/i);
});
```

- [ ] **B4: Test đỏ trước - xóa nguồn cảnh báo agent mất quyền**

```ts
it("hỏi xóa nguồn nói rõ bao nhiêu agent đang dùng", async () => {
  binding.datNguonChoAgent("a1", [n.id]);
  binding.datNguonChoAgent("a2", [n.id]);
  const res = await app.request(`/api/kb/sources/${n.id}/agents`, { headers: { cookie } });
  assert.equal((await res.json()).agentIds.length, 2);
});
```

Phần chữ trong hộp xác nhận kiểm bằng test giao diện nếu dựng được, không thì
khẳng định route trả đúng số và ghi rõ trong report rằng phần chữ chỉ kiểm bằng mắt.

- [ ] **B5: Test đỏ trước - modal nói trần dung lượng và chặn sớm**

```tsx
it("modal hiện trần dung lượng lấy từ cấu hình, không hard-code", async () => {
  tuning.setTuning("KB_MAX_FILE_MB", 7);
  render(<KbAddSourceModal />);
  assert.match(chuTrongModal(), /7\s*MB/);
});

it("chọn file quá trần bị chặn ngay, không gửi request nào", async () => {
  const goi: string[] = [];
  await chonFile(fileGia(50 * 1024 * 1024));
  assert.equal(goi.length, 0, "để server từ chối thì người dùng đợi vô ích");
  assert.match(loiHienRa(), /vượt quá/i);
});
```

- [ ] **B6: Test đỏ trước - xem đoạn đã cắt**

```ts
it("GET /sources/:id/chunks trả đoạn có phân trang", async () => {
  const res = await app.request(`/api/kb/sources/${n.id}/chunks?offset=0&limit=20`, { headers: { cookie } });
  const body = await res.json();
  assert.ok(Array.isArray(body.items));
  assert.equal(typeof body.total, "number");
  assert.ok(body.items[0].tieuDe !== undefined, "phải thấy breadcrumb để tự phát hiện lỗi đọc file");
});

it("route xem đoạn cũng đòi đăng nhập", async () => {
  assert.equal((await app.request(`/api/kb/sources/x/chunks`)).status, 401);
});
```

- [ ] **B7: `ListToolbar` cho trang Kho tri thức, dừng poll khi hết việc**

```tsx
it("poll dừng khi mọi nguồn đã san_sang", async () => {
  // Hiện setInterval(reload, 4000) chạy vĩnh viễn kể cả khi không còn gì để đợi.
  await choMoiNguonSanSang();
  const truoc = soLanGoiApi();
  await tick(12_000);
  assert.equal(soLanGoiApi(), truoc);
});
```

- [ ] **B8: `pnpm typecheck` (cả `-p web`) + `pnpm test`**

- [ ] **B9: Tự kiểm chuẩn giao diện**

Bốn mục, mỗi mục nói rõ đã kiểm thế nào trong report: responsive (thu hẹp cửa sổ
xuống 375px), con trỏ đúng trạng thái, control theo `ui-bits`, đủ ba trạng thái
rỗng/tải/lỗi. Cái nào chỉ kiểm được bằng mắt thì nói thẳng là kiểm bằng mắt.

- [ ] **B10: Phá code kiểm 6 chốt**

| Phá gì | Test phải đỏ | Đường code được chạy |
|---|---|---|
| Bỏ callback dirty của khối KB | "gạt nguồn rồi rời trang bị hỏi lại" | gộp cờ dirty |
| Bỏ refetch sau khi lưu | "badge đổi sang dùng được" | callback sau `luu()` |
| Trả `unavailableHint` cũ | "không chỉ sang tab không có ô gán" | chuỗi hint |
| Bỏ kiểm cỡ ở client | "chặn ngay, không gửi request nào" | `onChange` |
| Bỏ auth khỏi route xem đoạn | "cũng đòi đăng nhập" | middleware |
| Poll không dừng | "poll dừng khi mọi nguồn san_sang" | điều kiện dừng |

- [ ] **B11: Commit**

```
fix(kb): sửa ngõ cụt gán nguồn trên dashboard, thêm trang xem đoạn đã cắt
```

## Định nghĩa hoàn thành

- Tick nguồn chưa lưu không mất im lặng.
- Badge và câu hướng dẫn nói đúng, cùng chỉ về một chỗ.
- Xóa nguồn cảnh báo rõ agent nào mất quyền.
- Modal nói trần và chặn sớm.
- Xem được đoạn bot thật sự đọc ra từ file đã nạp.
- 6/6 phép phá đỏ đúng chỗ; 4 mục chuẩn giao diện đã tự kiểm.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Không có hạ tầng test cho React trong repo | Kiểm `web/src/**/*.test.ts` xem mẫu sẵn có; không có thì khẳng định ở tầng route và ghi rõ phần nào chỉ kiểm bằng mắt |
| Gộp cờ dirty làm form agent báo nhầm | B1 có ca "lưu xong thì không hỏi nữa" |
| Trang xem đoạn kéo cả nghìn đoạn về | Phân trang bắt buộc, `limit` có trần |
| Route mới quên auth | B6 có ca riêng |

## Bước tiếp

Phase 07 rà lại tài liệu và các mục nhỏ.
