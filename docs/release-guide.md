# Phát hành bản mới

Cách đánh số phiên bản và công bố để người dùng biết mà nâng cấp.

## Đánh số theo Semantic Versioning

`MAJOR.MINOR.PATCH` - dự án đang ở `0.x` nên MINOR được phép chứa thay đổi phá vỡ:

| Tăng số nào | Khi nào | Ví dụ trong dự án này |
|---|---|---|
| PATCH (`0.1.0` -> `0.1.1`) | Sửa lỗi, không đổi cách dùng | Vá lỗi lịch hẹn chạy trùng, sửa màu bị lệch ở chế độ tối |
| MINOR (`0.1.0` -> `0.2.0`) | Thêm tính năng, hoặc đổi cấu hình bắt buộc | Thêm công cụ mới, đổi tên biến môi trường, đổi cấu trúc bảng |
| MAJOR | Chỉ khi ra `1.0.0` | Chưa dùng tới |

Khi bản mới cần thao tác tay của người dùng (thêm biến môi trường, chạy lại
login...), viết rõ trong CHANGELOG mục **Nâng cấp** - người ta đọc release notes
để biết có phải làm gì không, không ai đọc diff.

## Cập nhật CHANGELOG khi có thay đổi (đừng để dồn)

Mỗi khi **thêm / sửa / xóa** một tính năng hoặc sửa lỗi đáng kể, thêm NGAY một
dòng vào mục `## [Chưa phát hành]` của `CHANGELOG.md`, đúng nhóm: `### Thêm` (mới),
`### Sửa` (vá lỗi), `### Đổi` (đổi hành vi/cấu hình đã có), `### Bỏ` (gỡ tính năng).

Vì sao phải làm NGAY: lần cắt `v0.2.0` (2026-08-30) mục này bị bỏ trống nhiều đợt
nên 3 tính năng lớn (tải video, Tab Bạn bè, MCP client) suýt không vào release
notes - phải dò lại `git log` mới phát hiện. Ghi lúc còn nhớ rẻ hơn dò lại.

Mốc "V3.xx" trong `docs/project-roadmap.md` là nhật ký phát triển nội bộ, KHÁC
semver `0.x` của release - đừng lẫn hai hệ.

## Các bước phát hành

### Trước khi cắt bản: verify (đừng release trên code đỏ)

- `git status` sạch, đang ở `main`.
- `pnpm typecheck` (root + web) xanh.
- `pnpm test` xanh - đây là LẦN chạy full suite được phép (một lần, cuối cùng).
- `pnpm build:web` xanh (bundle production biên dịch được).
- Rà mục `[Chưa phát hành]` đã đủ mọi thay đổi từ tag gần nhất chưa - đối chiếu
  `git log --oneline <tag-gần-nhất>..HEAD`.

Xong hết mới chạy:

```bash
# 1. Nâng số trong package.json (web tự đọc số này, không phải sửa thêm chỗ nào)
#    Sửa tay hoặc:
npm version 0.2.0 --no-git-tag-version

# 2. Cập nhật CHANGELOG.md: đổi "[Chưa phát hành]" thành phiên bản + ngày,
#    và thêm lại một mục "[Chưa phát hành]" rỗng ở trên cho lần sau

# 3. Commit
git add package.json CHANGELOG.md
git commit -m "chore(release): 0.2.0"

# 4. Tạo tag CÓ CHÚ THÍCH (-a), không phải tag trần
git tag -a v0.2.0 -m "v0.2.0"

# 5. Đẩy cả commit lẫn tag - thiếu --follow-tags là tag nằm lại máy mình
git push --follow-tags
```

## Tạo GitHub Release

Đẩy tag xong, tag đã hiện trên GitHub nhưng **chưa phải Release** - người theo
dõi repo chỉ nhận thông báo khi có Release thật.

```bash
# Cần gh CLI đã đăng nhập
gh release create v0.2.0 --title "v0.2.0" --notes-file <(sed -n '/## \[0.2.0\]/,/## \[0.1/p' CHANGELOG.md)
```

Hoặc làm trên web: repo -> Releases -> Draft a new release -> chọn tag -> dán
phần tương ứng trong CHANGELOG.

## Người dùng biết bằng cách nào

- **Theo dõi repo**: bấm Watch -> Custom -> Releases. GitHub gửi thông báo mỗi
  lần có Release mới. Đây là đường chính, và là lý do phải tạo Release chứ không
  chỉ đẩy tag.
- **Trang Releases** liệt kê mọi bản kèm ghi chú.
- **Số bản đang chạy** hiện ở chân sidebar dashboard, lấy tự động từ
  `package.json` lúc build - so với Releases là biết mình có cũ không.

## Người dùng nâng cấp

```bash
git fetch --tags
git checkout v0.2.0        # hoặc: git pull nếu bám theo main
pnpm install               # lockfile có thể đổi
pnpm build:web             # dashboard: bắt buộc build lại, nếu không vẫn chạy bản cũ
# đọc mục "Nâng cấp" trong CHANGELOG xem có phải thêm biến môi trường không
```

Dữ liệu trong `data/` giữ nguyên - migration của SQLite chạy tự động lúc khởi
động và đều idempotent, không phải làm gì thêm.

## Bài học từ lần cắt bản đầu (v0.2.0, 2026-08-30)

- **Kiểm `git ls-remote --tags origin` TRƯỚC khi giả định baseline.** `0.1.0`
  từng chỉ tồn tại trên giấy: CHANGELOG có link `v0.1.0` nhưng chưa hề có tag git
  thật (link 404). `v0.2.0` mới là tag đầu tiên; `v0.1.0` được tag HỒI TỐ tại
  commit dựng CHANGELOG (`931b9cb`, 2026-08-02): `git tag -a v0.1.0 <commit> -m "v0.1.0"`.
- **Chọn mốc tag hồi tố bằng commit thật + xác minh là tổ tiên của HEAD**:
  `git merge-base --is-ancestor <commit> HEAD`.
- **Link ở cuối CHANGELOG phải khớp tag CÓ THẬT.** Sau khi có cả hai tag, dạng
  chuẩn: `[Chưa phát hành]` so sánh `vMax...HEAD`; mỗi bản so sánh `vTruoc...vNay`;
  bản gốc trỏ `releases/tag/v...`.
- **Số phiên bản nhúng lúc BUILD.** Bump `package.json` xong, dashboard chỉ hiện
  số mới khi chạy lại `pnpm build:web` (web/dist là artifact, đã gitignore, không
  nằm trong commit release). Deploy phải build lại web.
- **push + GitHub Release là bước ra ngoài công khai** - báo tới người theo dõi
  repo, không rút lại gọn được. Hỏi user trước, đừng tự chạy.
