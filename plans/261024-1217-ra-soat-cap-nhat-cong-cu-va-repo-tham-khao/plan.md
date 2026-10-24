# Cập nhật dependency, công cụ, repo tham khảo (đợt 2026-10-24)

Báo cáo rà soát đầy đủ (bằng chứng, nguồn, câu hỏi mở):
[reports/bao-cao-ra-soat-cap-nhat-261024.md](reports/bao-cao-ra-soat-cap-nhat-261024.md)

## Nguyên tắc
- Mỗi phase: bump/sửa -> `pnpm typecheck` -> chạy ĐÚNG các file test liên quan
  (`npx tsx --test <file>`) -> commit riêng. Full suite `pnpm test` MỘT lần ở cuối.
- Không commit/push khi chưa hỏi. Mỗi phase thêm dòng vào `CHANGELOG.md` `[Chưa phát hành]`.
- Phase 05 và 08 có thay đổi hành vi/code - chờ người dùng chốt hướng trước.

## Các phase

| Phase | Nội dung | Rủi ro | Trạng thái |
|---|---|---|---|
| 01 | image-size 2.0.4 + test hồi quy ICNS (getter trả null, không treo) | Thấp | XONG |
| 02 | pnpm 11.28.7 (ở lại 11); `audit.level`; Node local 24.22.1 do người dùng tự cài (MSI cần quyền admin) | Thấp | XONG (trừ Node local) |
| 03 | Deps trong `^` range: hono, @hono/node-server, zod, unpdf, pino, cron-parser (kiểm job cron PROD trước + `.max(256)` cho expr), dev tools (vite vá bảo mật, react, tsx...), rồi `pnpm audit --fix=update`. docx làm CUỐI hoặc giữ 9.7.1 | Thấp-TB | XONG |
| 04 | zca-js 2.2.0 (ghim cứng) + smoke test trên nick phụ; theo dõi 2.2.1 (fix cmd 551) | Thấp | XONG |
| 05 | AI SDK: ai 7.0.150 + mcp/openai-compatible/anthropic/google cùng lúc; xử lý 2 đổi hành vi (timeout giữa lượt, stream không finish_reason) + test cho 2 ca probe | TB | XONG |
| 06 | yt-dlp: ghim `ARG YTDLP_VERSION=2026.10.21` trong Dockerfile; sửa chú thích cũ; nâng yt-dlp + certifi máy dev | Thấp | XONG |
| 07 | 9Router: (bot) kiểm `comboIds` trước `vision`; đổi model vẽ ảnh khỏi `cx/gpt-5.5-image`; (hạ tầng của anh) redeploy router v0.5.109 + `STRICT_SSL=true` | TB | XONG phần bot; model ảnh + router người dùng đã tự làm; `STRICT_SSL` chờ duyệt (restart router dùng chung) |
| 08 | Bug của bot soi ra từ repo tham khảo (loop guard nonce, fallback như câu thật, MCP isError/TAG/trần cỡ/session, tên người gửi...) - xem mục 7 báo cáo | TB | XONG |
| 09 | Tài liệu: CLAUDE.md + docs các dòng đã cũ; `git pull --ff-only` 9 repo tham khảo | Thấp | XONG |
| 10 | `pnpm test` 1 lần, `pnpm build`, `pnpm build:web`; deploy chờ người dùng duyệt commit/push | - | Đang làm |

## Thứ tự & phụ thuộc
- 01 làm ngay (bảo mật, độc lập).
- 03 (zod) trước 05: `@ai-sdk/*` dùng chung zod.
- 07 phần bot nên vào trước khi anh redeploy router (không thì combo bị đoán sai ngay).
- 06 cần rebuild image mới có tác dụng trên VPS.

## Kiểm chứng ngoài test (không tự động được)
- Smoke test nick phụ sau 04: login cookie, listener, tin định dạng, reaction, seen/typing,
  `tai_video` xem trên ĐIỆN THOẠI, accept bạn, QR login.
- Sau 07: "Vẽ thử 1 ảnh" trên dashboard với model mới.
- Sau 03: test tay dashboard sau `build:web` (`/`, deep link, `/assets/*`, `/api/x` 404 JSON).

## Kết quả kiểm trên VPS (2026-10-24)
- Router đã ở v0.5.109 (người dùng tự nâng), CHƯA có `STRICT_SSL`; log 72h: 0 lần lùi TLS không kiểm.
- zalo-agent prod: yt-dlp 2026.10.21, Node 24.22.1, Python 3.14.8, v0.3.1.
- DB prod: `image_gen_model = cx/gpt-image-2.5` (đã đổi), `llm_model = gpt-combo`, vision `auto` -> lỗi combo vision là THẬT.
- 13 job cron: cả 11 biểu thức khác nhau parse được trên cron-parser 5.10.2.
- Lượt rỗng sau tool: 0/117 lượt có trace -> không làm. Nhóm chạm trần 500 dòng, khoảng trống tối đa 385 -> đã sửa prune.
- 0 MCP server -> việc duyệt lại fingerprint một lần không ảnh hưởng.
