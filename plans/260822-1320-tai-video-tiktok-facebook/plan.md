# Tải video TikTok / Facebook rồi gửi qua Zalo

Người dùng dán link TikTok hoặc Facebook, bot tải bản không watermark rồi gửi
thẳng vào cuộc trò chuyện.

Số đo dựa vào: [`reports/do-luong-thuc-te.md`](reports/do-luong-thuc-te.md).
Mọi quyết định dưới đây đều đến từ số đo đó, không phải từ tài liệu nhà cung cấp.

## Quyết định đã chốt

| Quyết định | Vì sao |
|---|---|
| **TikWM là nguồn CHÍNH cho TikTok** | 12/12 so với 3/7 của yt-dlp, nhanh gấp 4, trả h264 |
| **yt-dlp là nguồn DỰ PHÒNG cho TikTok** | Độc lập hoàn toàn với TikWM - một cái sập cái kia vẫn chạy |
| **Facebook chỉ dùng yt-dlp** | TikWM không nhận Facebook; yt-dlp đo 5/5 |
| ~~Ưu tiên `sendVideo({videoUrl})`~~ **-> LẬT ở V3.22** | 0 byte qua VPS, nhưng đo trên máy thật: điện thoại KHÔNG phát được video trỏ CDN ngoài |
| **Luôn upload lên Zalo** (V3.22) | Đường duy nhất điện thoại xem được. Byte đi qua RAM, không chạm đĩa |
| **Đọc khung hình từ chính file** (V3.22) | Khai sai làm ứng dụng Zalo trên điện thoại CRASH; không nguồn nào khai đúng |
| **Ảnh bìa xin của Zalo qua `parseLink`** (V3.22) | Ảnh host ngoài thì thẻ video hiện đen thui |
| **Chọn format theo codec, không theo ID** | Mã format đổi âm thầm; `vcodec^=avc` thì không |
| **Song song 1, còn lại xếp hàng** (hạ từ 2 ở V3.22) | ~75 MB RAM mỗi tiến trình yt-dlp, **cộng cỡ video** kể từ V3.22 |
| Chặn theo thời lượng TRƯỚC khi tải | Metadata có `duration`, tốn một request |
| Whitelist domain | Bot đọc tin người lạ - URL tự do là đường SSRF |
| Không dùng cobalt | Không trả `duration`/`width`/`height`/`thumbnail` mà `sendVideo` cần |

## Các phase

| Phase | Nội dung | Trạng thái |
|---|---|---|
| [01](phase-01-nguon-va-metadata.md) | Whitelist, TikWM, yt-dlp, chuỗi dự phòng | **xong** |
| [02](phase-02-hang-doi-va-cau-hinh.md) | Hàng đợi song song 2, trần theo giờ, tham số dashboard | **xong** |
| [03](phase-03-tool-va-gui.md) | Tool `tai_video`, hai đường gửi, nối vào registry | **xong** |
| 04 | Vòng rà soát 1: 13 mục, SSRF userinfo, yt-dlp trong Docker | **xong** |
| 05 | Vòng rà soát 2 (soi BẢN VÁ): viết lại đường gửi, dò trước khi gửi, SSRF bộ chuyển hướng | **xong** |
| [06](phase-06-va-crash-dien-thoai.md) | V3.22: đọc khung hình từ file, upload lên Zalo, ảnh bìa `parseLink`, luật chéo RAM | **xong** |

## Tham số mới (nhóm "Tải video" trên trang Cấu hình)

| Tham số | Mặc định |
|---|---|
| Thời lượng tối đa | 30 phút |
| Dung lượng tối đa | 100 MB (kể từ V3.22 con số này nằm trong RAM, có luật chéo canh) |
| Số video mỗi giờ (mỗi người) | **15** |
| Chạy song song tối đa | **1** (hạ từ 2 ở V3.22) |
| Số lần thử lại mỗi nguồn | 4 |

## Rủi ro đã biết, đã chấp nhận

- **Khóa nick Zalo**: gửi video ồ ạt từ nick cá nhân là tín hiệu spam rõ. Trần
  15/giờ giảm bớt chứ không loại bỏ. Người dùng đã chấp nhận.
- **TikWM là dịch vụ miễn phí bên thứ ba**: có thể sập, thu phí, hoặc siết giới
  hạn bất cứ lúc nào. Đó chính là lý do giữ yt-dlp làm tầng 2.
- **Video ĐĂNG LẠI không gỡ được watermark**: watermark nằm sẵn trong file gốc.
  Bot phải nói thật chứ không im lặng gửi bản có watermark.
- **Link đi qua máy chủ TikWM**: họ biết người dùng tra video nào. Không lộ nội
  dung tin nhắn.

## Việc cần người dùng làm

Kiểm chứng ẩn số duy nhất còn lại: Zalo có nhận `videoUrl` trỏ sang host ngoài
không. Chỉ thử được trên nick đã đăng nhập.

Không chặn việc phát hành. Ban đầu tôi viết câu này dựa trên một tiền đề SAI
("`sendVideo` hỏng thì ném, ta bắt rồi lùi sang đường tải") - vòng rà soát 2 bác
bỏ nó bằng source zca-js. Giờ thì đúng vì lý do khác: bot DÒ URL trước khi gửi,
và cả ba đường đều có test. Log `duongGui` ghi `"url"` / `"tai-ve"` / `"yt-dlp"`
ở mỗi lần gửi thành công, nên câu trả lời tự hiện ra sau vài lượt dùng thật.
