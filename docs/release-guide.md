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

## Các bước phát hành

Từ nhánh `main` đã sạch và `pnpm test` xanh:

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
