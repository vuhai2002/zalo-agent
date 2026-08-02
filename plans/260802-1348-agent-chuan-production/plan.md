# Agent chuẩn production - khoảng cách A đến G

Đưa agent của zalo-agent từ "đúng vòng lặp, thiếu đo lường" lên production-grade,
theo 7 khoảng cách A-G trong `reports/audit-agent-chuan-production.html`.

## Bối cảnh

- Audit đầy đủ: [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html)
  (mục 8/A **đã đính chính** ngày 02/08 - đọc trước khi làm phase 02)
- Thiết kế màn hình agent: [reports/thiet-ke-man-hinh-tao-agent.html](reports/thiet-ke-man-hinh-tao-agent.html)
- Nghiên cứu nền: [reports/research-01-dinh-nghia-agent-va-doi-chieu.md](reports/research-01-dinh-nghia-agent-va-doi-chieu.md)

## Quyết định đã chốt với người dùng (đừng lật lại)

1. **Tool = giao của hai lớp.** Agent và account đều lưu danh sách **TẮT**; tool dùng
   được khi không bên nào tắt. Không bên nào bật ngược lại được bên kia. Lưu danh sách
   TẮT (không phải BẬT) để tool mới thêm vào code tự có cho agent cũ - đúng nếp
   `accounts.disabled_tools` (`database.ts:247`).
2. **F không phải approval gate.** 12-Factor #7 nói về agent chủ động hỏi khi THIẾU
   THÔNG TIN. Bỏ hẳn approval gate và tool `ask_user`; F rút về 3 dòng trong
   `BASE_PERSONA` + case eval canh.
3. **Eval hai lệnh.** `pnpm test` (model giả) lo phần tất định; `pnpm eval` (model thật)
   lo phần hành vi. Không trộn - trộn là CI đỏ vì lý do không phải lỗi code.
4. **Tạo tách khỏi sửa.** Tạo = 2 ô (tên + persona), ID tự sinh. Sửa = trang riêng đủ
   10 trường.
5. **Ngoài phạm vi đợt này:** trạng thái Đang chạy/Tạm dừng, trần chi tiêu USD, agent con,
   knowledge base, tab Files/Instances kiểu GoClaw.

## Các phase

| # | Phase | Gap | Trạng thái |
|---|---|---|---|
| 01 | [Tách trang Agent + tạo nhanh](phase-01-tach-trang-agent-va-tao-nhanh.md) | nền UI | Xong (1130f6c) |
| 02 | [Công cụ theo agent](phase-02-cong-cu-theo-agent.md) | A | Xong (93fa8c4) |
| 03 | [Ngân sách token thật](phase-03-ngan-sach-token-that.md) | D | Xong (0b6718f + 849ad43) |
| 04 | [Chặn vòng lặp tool](phase-04-chan-vong-lap-tool.md) | B | Xong (83595e8 + 2a401ce) |
| 05 | [Phân loại lỗi provider](phase-05-phan-loai-loi-provider.md) | G | Xong (4a1a825) |
| 06 | [Kiểm tra đầu ra](phase-06-kiem-tra-dau-ra.md) | E | Xong (03dbd41 + 3e08906) |
| 07 | [Bộ eval model thật](phase-07-bo-eval-model-that.md) | C | Xong (bdfc018 + 65900ad) |
| 08 | [Luật hỏi lại](phase-08-luat-hoi-lai.md) | F | Xong (b9ee0da) |

## Phụ thuộc giữa các phase

```
01 (trang Agent)
 |
 +-- 02 (A: cong cu)      can o tick tren trang sua
 +-- 03 (D: token)        can o tran context tren trang sua
       |
       +-- 05 (G: loi)    nhanh context_overflow goi lai ham cat cua 03

04 (B: vong lap)   doc lap
06 (E: dau ra)     doc lap
07 (C: eval)       nen lam SAU 02-06 de co cai ma do
 |
 +-- 08 (F: hoi lai)  can eval de kiem chung dong persona
```

Chỉ 01 chặn 02/03, và 03 chặn một nhánh của 05. Bốn phase 04/05/06/07 làm song song được.

## Ràng buộc xuyên suốt

- File code < 200 dòng. Tách module khi vượt.
- **(Cập nhật sau phase 07)** Env var mới khai schema Zod trong `src/config/env.ts`
  KÈM `.default()`; tham số chỉnh lúc chạy thì thêm vào
  `src/config/tuning-definitions.ts` là tự hiện trên dashboard. CHỈ đụng vào
  `.env.example` / `.env.production.example` khi biến phải đọc TRƯỚC lúc mở DB.
  Luật "đủ 3 nơi" cũ đã bị lật - xem `CLAUDE.md`.
- `pnpm typecheck` sạch trước khi báo xong phase.
- Test chạm DB phải gọi `setupTestEnv()` xong mới `await import()` động - xem mục
  "Bẫy khi viết test" trong `CLAUDE.md`.
- Không tự commit. Xong phase thì báo, người dùng quyết.

## Nghiệm thu cả đợt

- `pnpm test` xanh, `pnpm typecheck` sạch.
- `pnpm eval` chạy được với model thật, in bảng kết quả.
- Dựng được 2 agent khác toolset trên cùng 1 nick Zalo và chứng minh được model
  nhận đúng schema khác nhau (đọc trang Trace).
- Gọi lặp 1 tool lỗi không còn đốt hết trần step.
