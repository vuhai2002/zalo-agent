# Số đo thực tế - tải video TikTok / Facebook

Đo ngày 2026-08-22. Mọi con số dưới đây là ĐO THẬT, không phải đọc tài liệu.
Giữ file này vì các quyết định thiết kế đều dựa vào chúng - ai muốn lật lại một
quyết định thì phải đo lại, không lập luận suông.

## Độ tin cậy - đo cùng IP, cùng khung giờ

| Nguồn | TikTok | Facebook |
|---|---|---|
| **TikWM** | **12/12 (100%)** | không hỗ trợ (`Url parsing is failed`) |
| **yt-dlp** | 3/7 (~43%) | **5/5** |
| curl trần | **0/6** (trang thử thách 1462 byte) | - |

yt-dlp chậm hơn: 3,9s so với 1,04s của TikWM.

### Bốn cách đã thử để cứu yt-dlp trên TikTok - đều không ăn thua

| Cách | Kết quả |
|---|---|
| mặc định | 3/7 |
| `--impersonate chrome` (giả TLS fingerprint) | 3/8 |
| `--extractor-args api_hostname=...` | 2/8 |
| `--extractor-args device_id=...` (API app) | 1/8 |

Thử lại có lùi thì cứu được phần nào: 4 lần thử -> **5/6 phiên (83%)**, trung
bình 3,2 lời gọi mỗi phiên.

CẢNH BÁO KHI ĐỌC SỐ NÀY: `curl` trần bị chặn 6/6 nghĩa là IP đo đã bị TikTok
đánh dấu (đã gọi ~50 lần trong ít phút). Trên IP sạch, tỉ lệ của yt-dlp gần như
chắc chắn cao hơn. Con số 43% là CẬN DƯỚI, không phải giá trị kỳ vọng.

## URL có mang đi được không (quyết định băng thông)

Phép thử: `curl` KHÔNG kèm header nào, giả lập máy người nhận Zalo.

| Nguồn URL | Kết quả |
|---|---|
| **TikWM `play`** | **206, video/mp4** - mang đi được |
| **yt-dlp Facebook** | **206, video/mp4** - mang đi được, hạn **107,6 giờ** |
| yt-dlp TikTok | **403** kể cả kèm đúng Referer + User-Agent |

URL của yt-dlp cho TikTok gắn với cookie phiên vừa lập (`Downloading webpage
with challenge cookie`), nên không mang đi được.

Hệ quả: cả hai nền tảng đều đi được đường `sendVideo({videoUrl})` - **0 byte
video qua VPS** - miễn là TikTok đi qua TikWM.

## Watermark - đã kiểm bằng mắt trên khung hình

Video thử: `vt.tiktok.com/ZSV5bEotV` (kênh `phapquang_senhong`, 58 giây).

| Trường | Logo TikTok + @username | Dung lượng |
|---|---|---|
| `play` | **KHÔNG có** | 6.667.679 |
| `wmplay` | có, và **di chuyển** giữa giây 5 và giây 20 | 7.500.904 |

Chênh 833.225 byte chính là phần watermark nung vào. Watermark di chuyển là
dấu hiệu của watermark động do TikTok dán, không phải thứ có sẵn trong file.

**=> Dùng `play`, tuyệt đối không dùng `wmplay`.**

### Ca không gỡ được - phải nói trước với người dùng

Video thử đầu tiên (`@tiktok/video/7106594312292453675`) có watermark ở CẢ hai
bản. Bằng chứng đó là watermark nung sẵn chứ không phải lỗi công cụ: URL tải là
`@tiktok` nhưng watermark ghi `@gorilloyt`. TikTok dán watermark lúc phục vụ
file thì phải ghi tài khoản mình tải; ghi tên người khác nghĩa là chữ đó đã nằm
trong file trước khi được đăng lại.

Video ĐĂNG LẠI thì không tool nào gỡ được, kể cả trả phí.

## Tài nguyên - đo trên tiến trình Python thật

| | RAM đỉnh | CPU | Thực tế |
|---|---|---|---|
| yt-dlp chỉ metadata | **72,8 MB** | 1,44s | 3,94s |
| yt-dlp tải video 5 MB | **75,6 MB** | 1,34s | 3,44s |

RAM gần như KHÔNG đổi giữa hai ca - yt-dlp ghi thẳng ra đĩa, không đệm video
vào RAM. ~73 MB là bản thân Python + yt-dlp.

Suy ra: chi phí cố định mỗi tiến trình, không theo cỡ video. Song song 2 -> ~150 MB.

## Giới hạn của TikWM

- **1 request/giây** - báo thẳng trong lỗi: `Free Api Limit: 1 request/second`.
  Đo: 10 lần liên tiếp không nghỉ -> 5/10; có nghỉ 1s -> 12/12.
- **Không hỗ trợ Facebook**.
- Trả **h264 576x1024** (yt-dlp lấy được 1080x1920 nhưng là **h265**).
- Phân giải link rút gọn `vt.tiktok.com` tốt - không cần bot xử lý thêm.

## yt-dlp: cập nhật có phải sửa code không

Đọc Changelog chính thức, toàn bộ breaking change 2025-2026:

| Phiên bản | Nội dung |
|---|---|
| 2026.07.04 | Python tối thiểu 3.11; Windows 10+; vá `--write-link` |
| 2026.06.09 | Deno/Node tối thiểu; `--exec` đổi cú pháp; aria2c bỏ HLS/DASH |
| 2026.02.21 | `--netrc-cmd` giới hạn ký tự |
| 2025.11.12 | YouTube cần JS runtime ngoài |

**Không cái nào đụng schema JSON của `--dump-single-json`.** Các trường dùng ở
đây (`duration`, `width`, `height`, `thumbnail`, `url`, `filesize`, `ext`) là
phần lõi kế thừa từ youtube-dl, ổn định nhiều năm. 6 bản stable trong 2026.

Hai thứ phải canh: Python tối thiểu (đụng base image Docker) và **mã format đổi
âm thầm** - nên chọn theo THUỘC TÍNH codec (`vcodec^=avc`), không hardcode
`h264_540p_1071120`.

## Phía Zalo - tra từ source zca-js

| Hàm | Byte video qua VPS |
|---|---|
| `sendVideo({videoUrl, thumbnailUrl})` | **0** - chỉ một HEAD lấy `content-length` |
| `sendMessage({attachments:[path]})` | **2x** - tải về rồi upload lên CDN Zalo |

`sendVideo.ts:71` chỉ gọi `utils.request(videoUrl, {method:"HEAD"})` rồi nhét
`videoUrl` vào JSON tin nhắn. Video không bao giờ chạm tiến trình bot.

Kênh **Zalo Bot API KHÔNG có** method gửi video - tool này phải nằm trong
`TOOL_KHONG_CHAY_TREN_BOT`.

## Ẩn số CHƯA kiểm chứng được

**Zalo có nhận `videoUrl` trỏ sang host ngoài không?** Không thử được vì sandbox
không có nick Zalo. Nếu Zalo từ chối thì phải rơi về đường tải-rồi-upload -
code phải có sẵn nhánh đó ngay từ đầu, không được coi đường URL là chắc chắn.
