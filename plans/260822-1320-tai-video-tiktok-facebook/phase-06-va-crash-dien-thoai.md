# Phase 06 - Vá crash trên ứng dụng điện thoại (V3.22)

**Trạng thái: xong.** Nghiệm thu trên máy thật của người dùng, họ chốt hướng B.

Ngữ cảnh: [plan.md](plan.md) - [roadmap V3.22](../../docs/project-roadmap.md)

## Triệu chứng người dùng báo

1. *"cái video tiktok tôi gửi sau đó là dạng video ngang nhưng nó lại nhận khung
   dọc, trên điện thoại là ko xem được luôn á"*
2. Sau khi vá khung hình: *"giờ ra đúng rồi nhưng trên điện thoại vẫn ko xem
   được, zalo crash luôn"*

Cả hai chỉ hiện trên ĐIỆN THOẠI. Máy tính xem bình thường suốt.

## Phát hiện chính: đây là HAI lỗi, không phải một

Gửi cùng một video, mỗi lần đổi đúng một biến, tới đúng máy người dùng:

| Biến thể | Ảnh bìa | Khung hình | Máy tính | Điện thoại |
|---|---|---|---|---|
| V3.21 | đen | sai | méo | crash |
| A: URL ngoài + ảnh bìa Zalo | đúng | đúng | tốt | không phát được |
| B: upload lên Zalo + ảnh bìa Zalo | đúng | đúng | tốt | **mượt** |
| C: gửi dạng file đính kèm | - | - | tốt | tốt |

- **Crash** <- khung hình khai sai (A đã hết crash).
- **Không phát được** <- `videoUrl` trỏ CDN ngoài (chỉ B chữa được).

### Đã kiểm chứng trên máy thật - đừng research lại

**B và C đều CHẠY ĐƯỢC**, cả trên máy tính lẫn điện thoại, đã test cùng một
video. Người dùng chốt: *"ok good, cả 2 cái đều chuẩn. Tôi chọn B vì nó tốt hơn
hẳn thật đó!"* - chọn thẻ video vì đẹp hơn, KHÔNG phải vì C hỏng. Nên C là đường
lui đã kiểm chứng nếu `uploadAttachment` gặp vấn đề.

**A là thứ duy nhất bị loại.** Nó gửi được, ảnh bìa đúng, không crash, máy tính
xem tốt - chỉ điện thoại không phát được. Đừng đo tính năng video trên máy tính
rồi kết luận.

## Ràng buộc người dùng đặt ra

> *"tôi rất ngại video đi qua vps của tôi, băng thông tôi ko lo vì ko có giới
> hạn, nhưng cứ tải xóa liên tục như vậy thể nào vps cũng rất rác. Mặc dù up
> xong là xóa ngay, nhưng cũng giống ssd cứ đọc ghi liên tục nó cũng sẽ có rác.
> Và chưa tính lỡ video đó chứa gì đó mình ko handle được."*

Mối lo là ĐỌC/GHI SSD và NỘI DUNG KHÔNG KIỂM SOÁT - không phải băng thông. Đã rà
cả 140 API của zca-js: không có đường nào đưa Zalo một URL rồi Zalo tự tải về.
Nên byte buộc phải đi qua bot, và hai mối lo phải giải riêng:

- **Đọc/ghi SSD**: `uploadAttachment` nhận `{data: Buffer, ...}`, yt-dlp xuất qua
  `-o -`. Đường đi thành mạng -> RAM -> Zalo, **không có file tạm nào**.
- **Nội dung không kiểm soát**: byte chỉ đi qua bộ đọc `tkhd` rất hẹp rồi lên
  Zalo. Không có bộ giải mã media nào chạy trên máy chủ (cũng là lý do image cố ý
  không cài ffmpeg).

## File đã đổi

Thêm:
- `src/video/doc-khung-hinh-mp4.ts` (+ test, 13 ca)
- `src/video/lay-anh-bia-zalo.ts` (+ test, 6 ca)
- `src/video/tai-video-vao-ram.ts` (+ test, 13 ca)

Viết lại: `src/video/gui-video-qua-zalo.ts` (ba đường -> một đường)

Xóa: `src/video/tai-bang-yt-dlp.ts`, `src/shared/safe-remote-download-to-file.ts`,
`withEmptyTempFile`/`withEmptyTempDir` trong `temp-file-store.ts`

Sửa: `chay-yt-dlp.ts` (stdout nhị phân + tách `tuyChonExec`),
`runtime-tuning-settings.ts` (luật chéo RAM), `tuning-definitions.ts` (2 câu gợi ý)

## Nghiệm thu

Chạy qua ĐÚNG code sản xuất, không qua script chẩn đoán:

| Video | Nguồn KHAI | Đọc từ file | Byte | Thời gian |
|---|---|---|---|---|
| TikTok ngang | 576x1024 (sai) | 1002x576 | 9.972.708 | 3,7 s |
| Facebook (từng gây crash) | 1280x720 | 1280x720 | 44.018.991 | 3,5 s |

12 phép phá, 12/12 đỏ. Một phép (`encoding: "buffer"`) ban đầu KHÔNG đỏ vì nằm
trong hàm chạm tiến trình - phải tách `tuyChonExec()` thuần rồi mới canh được.
Đây là lần thứ ba cùng hình dạng lỗi đó trong dự án (`envToiThieu`,
`dungLoiGoi`, `tuyChonExec`).

## Việc còn treo

- Trần dung lượng mặc định 100 MB là con số chọn hồi byte nằm trên đĩa. Giờ 100
  x 2 lượt = 350 MB RAM đỉnh - lọt trên VPS 2 GB nhưng không dư nhiều. Để người
  dùng quyết vì đó là ngưỡng họ đã chọn.
- `uploadAttachment` cần listener đang chạy; mất listener là promise treo vĩnh
  viễn. Đã bọc trần 5 phút nhưng đó là lưới đỡ, không phải lời giải.
- Biến thể C (gửi dạng file) chạy tốt, đã được người dùng kiểm chứng - xem khối
  "Đã kiểm chứng trên máy thật" ở trên.
- Trần song song hạ 2 -> 1 (người dùng chốt "cho chắc"): RAM đỉnh còn 175 MB.
  Đánh đổi là hai người cùng gửi link thì người thứ hai xếp hàng chờ.
