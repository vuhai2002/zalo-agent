# Phase 01 - Tách trang Agent + tạo nhanh

## Liên kết ngữ cảnh

- Thiết kế màn hình: [reports/thiet-ke-man-hinh-tao-agent.html](reports/thiet-ke-man-hinh-tao-agent.html) mục 4-5
- Code hiện tại: `web/src/pages/agent-edit-drawer.tsx` (196 dòng), `web/src/pages/agents-page.tsx` (122 dòng)
- API: `src/server/routes/agent-routes.ts`, store: `src/config/agent-store.ts`

## Tổng quan

- **Ưu tiên**: cao - chặn phase 02 và 03
- **Trạng thái**: XONG (commit 1130f6c)
- Tách form tạo/sửa agent làm hai. Tạo = modal 2 ô, ID tự sinh từ tên. Sửa = trang riêng
  `/agents/:id` chia nhóm, đủ chỗ cho các trường của phase 02-03. Vá luôn lỗi
  `modelProvider` bị giấu.

## Nhận định then chốt

- **`modelProvider` đang bị giấu, không phải thiếu.** Có trong bảng `agents`, trong
  `patchSchema` (`agent-routes.ts`), trong type `AgentProfile` - chỉ drawer không render
  và không gửi. Hệ quả: agent tạo từ UI vĩnh viễn dùng provider chung, muốn một agent
  chạy thẳng Anthropic phải sửa DB tay. Vá được ngay, không đợi gì.
- **Không đổi backend.** Phase này thuần frontend cộng một dòng vá schema nếu cần.
- **`react-router-dom` đã có sẵn** (`web/src/app.tsx:2`), thêm route lồng là chuyện thường.
- **Bẫy khi tự sinh ID**: `"đ".normalize("NFD")` **không** tách ra thành `d` + dấu -
  `đ`/`Đ` (U+0111/U+0110) là chữ cái riêng, không phải chữ nền cộng dấu tổ hợp. Phải thay
  tường minh trước khi normalize, nếu không "Đặng" ra `ng` thay vì `dang`.

## Yêu cầu

Chức năng:
- Bấm "Tạo agent" mở modal nhỏ: Icon, Tên hiển thị, ID (tự sinh, bấm mới sửa được), Persona.
- Tạo xong điều hướng thẳng vào `/agents/:id`.
- Trang `/agents/:id` chia nhóm: Danh tính / Chỉ dẫn / Model. (Nhóm Công cụ do phase 02 thêm.)
- Trang sửa có select **Provider**: `Theo Providers chung` / `openai-compatible` / `anthropic`.
- ~~Trường Model nâng thành dropdown lấy danh sách từ trang Providers~~ **KHÔNG LÀM**:
  trang Providers cũng chỉ có MỘT ô text, không giữ danh sách model nào - dựng dropdown ở
  đây sẽ là danh sách bịa. Thay bằng: lấy model chung thật làm gợi ý trong ô.

Phi chức năng:
- Mỗi file mới < 200 dòng.
- Dùng lại ngôn ngữ thiết kế trang Cấu hình: nhóm phẳng, tiêu đề chữ nhỏ in hoa, không
  lồng khối, không đổ bóng chồng.

## Kiến trúc

```
web/src/pages/
  agents-page.tsx              danh sach + nut Tao (sua: bo drawer, dieu huong sang trang)
  agent-create-modal.tsx       MOI  - 2 o + ID tu sinh
  agent-detail-page.tsx        MOI  - khung trang sua + luu
  agent-identity-section.tsx   MOI  - icon, ten, ID chi doc
  agent-model-section.tsx      MOI  - provider, model, so buoc, muc suy nghi
web/src/shared/
  slugify-vietnamese.ts        MOI  - ten -> kebab-case
```

`agent-edit-drawer.tsx` bị xóa sau khi hai nơi dùng nó đã chuyển hết.

## File liên quan

Sửa:
- `web/src/app.tsx` - thêm `<Route path="/agents/:id" element={<AgentDetailPage />} />`
- `web/src/pages/agents-page.tsx` - bỏ drawer, thêm modal tạo + điều hướng
- `web/src/dashboard-api-client.ts` - nếu `ManagedAgent` chưa phơi `modelProvider` thì bổ sung

Tạo: 6 file ở mục Kiến trúc.

Xóa: `web/src/pages/agent-edit-drawer.tsx` (sau cùng).

## Các bước

1. Viết `slugify-vietnamese.ts`: thay `đ`->`d`, `Đ`->`D` **trước**, rồi `normalize("NFD")`
   + bỏ dải dấu tổ hợp `̀-ͯ`, hạ chữ thường, thay mọi ký tự ngoài `[a-z0-9]`
   thành `-`, gộp `-` liên tiếp, cắt `-` ở hai đầu. Viết test cho: có dấu, có `đ`, có
   ký tự đặc biệt, chuỗi rỗng, chuỗi toàn ký tự lạ (phải trả về chuỗi rỗng để UI biết
   mà bắt người dùng tự gõ).
2. `agent-create-modal.tsx`: ô Tên gõ tới đâu sinh ID tới đó, hiện ID mờ bên dưới kèm chữ
   "sửa". Bấm "sửa" thì ID thành ô nhập tay và **ngừng** tự sinh (tránh ghi đè cái người
   dùng vừa gõ). Nút Tạo tắt khi tên rỗng hoặc ID rỗng.
3. Trùng ID: API đã trả 409 kèm `"Agent id đã tồn tại"`. Bắt lỗi này và hiện ngay dưới ô ID,
   không hiện toast chung chung.
4. `agent-detail-page.tsx`: đọc `:id`, gọi `api.agentsAdmin` lấy agent. Không tìm thấy thì
   hiện trạng thái rỗng + link về `/agents`.
5. Tách 2 section, khung trang chỉ lo tải/lưu/báo lỗi.
6. Thêm select Provider vào `agent-model-section.tsx`, gửi `modelProvider` trong patch.
   Giá trị rỗng gửi lên `null` (bỏ override) - `patchSchema` đã nhận `.nullable()`.
7. ~~Model thành dropdown~~ - bỏ, xem mục Yêu cầu. Giữ ô gõ tự do, đặt model chung thật
   làm placeholder.
8. Chuyển `agents-page.tsx` sang dùng modal + `useNavigate`, xóa `agent-edit-drawer.tsx`.
9. `pnpm typecheck` + `pnpm build:web`.

## Việc cần làm

- [x] `slugify-vietnamese.ts` + test (có `đ`, có dấu, ký tự lạ, rỗng)
- [x] `agent-create-modal.tsx` (tự sinh ID, ngừng khi sửa tay, bắt lỗi 409)
- [x] Route `/agents/:id`
- [x] `agent-detail-page.tsx` + 2 section
- [x] Select Provider (vá lỗi bị giấu)
- [~] Model thành dropdown - **bỏ có lý do**, xem mục Yêu cầu
- [x] `agents-page.tsx` chuyển sang modal + điều hướng
- [x] Xóa `agent-edit-drawer.tsx`
- [x] `pnpm typecheck` + `pnpm build:web` sạch

## Tiêu chí hoàn thành

- Tạo agent mới chỉ cần gõ tên và persona; ID hiện đúng dạng kebab-case không dấu.
- Tạo xong ở ngay trang sửa của agent vừa tạo.
- Đổi Provider của một agent sang `anthropic`, tải lại trang, giá trị vẫn còn (chứng minh
  patch có gửi và store có ghi).
- Không còn file nào trong `web/src/pages/agent*` vượt 200 dòng.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Tự sinh ID ghi đè ID người dùng vừa gõ tay | Bấm "sửa" là tắt hẳn tự sinh, không bật lại |
| Tên toàn ký tự lạ ra ID rỗng, API 400 | Slug rỗng thì tắt nút Tạo và hiện gợi ý tự gõ ID |
| Dropdown model không lấy được danh sách (Providers chưa cấu hình) | Luôn còn mục `Tự gõ...`, không để người dùng kẹt |

## An ninh

- ID vẫn phải qua regex `^[a-z0-9][a-z0-9-]*$` ở server (`createSchema` đã có). Tự sinh ở
  client là tiện ích, **không** phải lớp kiểm tra.
- Trang sửa nằm sau `dashboard-auth` như mọi trang khác, không thêm đường nào mới.

## Bước kế tiếp

Mở khóa phase 02 (ô tick Công cụ) và phase 03 (ô Trần context) - cả hai đều cần trang sửa này.
