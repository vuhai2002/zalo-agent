# Phase 03 - Kênh không mang định dạng thì không tính `styles` vào ngân sách byte

Ưu tiên: trung bình. Độc lập với 01/02 nhưng nên nằm TRƯỚC 04.
Trạng thái: [x] xong.
Bối cảnh: [reports/nguyen-nhan-goc.md](reports/nguyen-nhan-goc.md) mục 6a.

## Vấn đề

`soByteTin` (`split-styled-message.ts:42`):

```ts
const chu = Buffer.byteLength(tin.text, "utf8");
return chu + Buffer.byteLength(JSON.stringify({ styles: tin.styles }), "utf8");
```

Trên kênh bot, `dinhDangNeuBat` vẫn sinh `styles`, rồi `kenhBot.duongGui` VỨT
chúng (`kenh-bot.ts`: "KHÔNG truyền `styles` - trường của zca-js, Bot API
không hiểu"). Nên ngân sách byte đếm phần không bao giờ đi trên dây - chẻ thừa
tin.

Hệ quả thứ hai, ngầm hơn: `sendOneCoDuongLui` thấy `coCaiDeBo === true`
(`styles.length > 0`) nhưng `laLoiMayChuTuChoi` trả `false` cho
`LoiZaloBotApi`, nên đường lui không chạy. Đúng một cách TÌNH CỜ - gửi lại y
hệt (styles vốn bị vứt) chỉ tốn một lời gọi API. Không ai ghi xuống. Ai "dọn
dẹp" `laLoiMayChuTuChoi` cho hiểu `LoiZaloBotApi` là bật ra lời gọi thừa đó.

Đây là lỗi CÓ SẴN của đường chat, không phải do đợt này sinh ra. Đưa vào đây
vì scheduler vừa thừa hưởng đúng đường ống đó, và vì sửa gốc tắt cả hai hệ quả
cùng lúc.

## Cách làm

Kênh tự khai có mang được định dạng hay không - đúng khuôn `tranKyTuMotTin` đã
có (kênh khai, `ReplyTarget` chở theo, đường gửi đọc).

### Files sửa

| File | Việc |
|---|---|
| `src/zalo/kenh-luot.ts` | Thêm `mangDinhDang?: boolean` (thiếu = có, tức hành vi kênh cá nhân) |
| `src/zalo-bot/kenh-bot.ts` | `mangDinhDang: false` |
| `src/zalo/send-reply-in-parts.ts` | `ReplyTarget.mangDinhDang?: boolean`; `sendReplyInParts` bỏ `styles` khi kênh không mang |
| `src/zalo/deliver-chat-reply.ts` | Truyền `kenh.mangDinhDang` vào target |
| `src/scheduler/scheduled-job-reply-target.ts` | Chở `mangDinhDang` (phase 02 đã tạo file) |

### Điểm khó: BÓC markdown vẫn phải chạy

Không được bỏ hẳn `dinhDangNeuBat` cho kênh bot - nó vừa sinh `styles` VỪA bóc
dấu markdown ra khỏi chữ (`"**Bảng giá** đây anh"` -> `"Bảng giá đây anh"`).
Bỏ nó là đẩy `**` thô xuống Zalo, tệ hơn hiện tại.

Nên: vẫn chạy `dinhDangNeuBat`, lấy `.text`, VỨT `.styles` ngay tại chỗ dựng
`ReplyTarget`/gọi `sendReplyInParts`. Chọn vứt ở **`sendReplyInParts`** (một
chỗ) chứ không ở từng caller (hai chỗ: `deliver-chat-reply` và
`scheduled-job-send`) - hai chỗ là hai cơ hội quên.

```ts
export async function sendReplyInParts(target, text, styles = []) {
  // Kênh không mang định dạng (Bot API) thì `styles` sẽ bị đường gửi vứt.
  // Vứt Ở ĐÂY, TRƯỚC bộ cắt: `soByteTin` cộng cả JSON của styles vào ngân
  // sách byte, nên giữ lại là tính tiền cho thứ không bao giờ đi trên dây và
  // chẻ thừa tin. Chữ đã được bóc markdown ở tầng trên nên không mất gì.
  const stylesThat = target.mangDinhDang === false ? [] : styles;
  ...
}
```

## Tests

File mới: `src/zalo/ngan-sach-byte-theo-kenh.test.ts`

| # | Ca | Khẳng định |
|---|---|---|
| 1 | kênh không mang định dạng | `guiMotDoan` nhận `styles` là `undefined`/rỗng, và `text` KHÔNG còn ký tự `*` của markdown |
| 2 | ngân sách byte không đếm styles bị vứt | CÙNG một chuỗi markdown nặng span: kênh cá nhân chẻ N tin, kênh bot chẻ ÍT HƠN. Chuỗi phải chọn sao cho chỉ riêng byte của `JSON.stringify({styles})` đẩy qua ngưỡng - dựng bằng cách đo `soByteTin` trước khi chốt hằng số, KHÔNG đoán |
| 3 | không có đường lui thừa | server từ chối (`guiMotDoan` ném) -> `guiMotDoan` được gọi ĐÚNG 1 lần trên kênh không mang định dạng (bản cũ: cũng 1 lần, nhưng vì lý do tình cờ - ca này khoá hành vi lại bằng lý do TƯỜNG MINH) |
| 4 | kênh cá nhân KHÔNG hồi quy | cùng chuỗi ca 2, kênh cá nhân vẫn nhận đủ `styles` và số tin y như trước phase này |
| 5 | `mangDinhDang` thiếu = có | target không khai trường này vẫn giữ `styles` (bảo vệ mọi call site cũ) |

Ca 2 là ca dễ viết thành xanh giả nhất. Bắt buộc: trước khi chốt hằng số, in
`soByteTin` của cả hai bản và khẳng định trong test rằng bản CÓ styles thật sự
vượt `maxPayloadBytes` còn bản không styles thì không - nếu không, ca này chỉ
đang đo bộ cắt ký tự chứ không đo ngân sách byte.

### Phép phá bắt buộc

| Phá gì | Ca phải ĐỎ |
|---|---|
| Bỏ dòng `stylesThat` (luôn giữ styles) | 1, 2, 3 |
| `mangDinhDang === false` -> `mangDinhDang !== true` | 5 |
| `kenhBot` không khai `mangDinhDang` | 1, 2 (qua đường `deliver-chat-reply`) |

## Tiêu chí xong

- 5 ca xanh, 3 phép phá đỏ đúng ca.
- `split-styled-message.test.ts`, `split-long-message.test.ts`,
  `send-reply-style-fallback.test.ts`, `send-reply-quote.test.ts`,
  `kenh-bot.test.ts`, `luot-tren-kenh-bot.test.ts` xanh nguyên.
- Comment trong `send-reply-in-parts.ts` ghi rõ vì sao vứt Ở ĐÂY chứ không ở
  caller, và ghi rõ tình trạng `laLoiMayChuTuChoi` với `LoiZaloBotApi` để lần
  sau không ai "dọn dẹp" nhầm.

## Rủi ro

- Vứt `styles` quá sớm sẽ làm mất định dạng của kênh CÁ NHÂN nếu điều kiện
  viết ngược. Ca 4 và 5 là chốt chặn.
- `trichDanTrongNganSach` vẫn chạy cho kênh bot dù `quote` không bao giờ được
  đặt cho job. Vô hại (quote `undefined` -> không trừ gì), không đụng.
