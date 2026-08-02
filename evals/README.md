# Bộ eval - chạy model THẬT

```bash
pnpm eval                                  # chạy hết
EVAL_ONLY=gio-chinh-xac,tra-cuu pnpm eval       # chạy tập con (mỗi lượt là token thật)
```

Thoát mã 0 khi mọi case đạt, mã 1 khi có case hỏng.

## Vì sao tồn tại song song với `pnpm test`

Hai thứ khác MỤC ĐÍCH, không phải khác mức độ.

`pnpm test` chạy model giả nên đo được chuyện tất định: dây nối, nhánh lỗi, thứ tự
xử lý. Model giả trả về đúng thứ mình lập trình cho nó trả, nên nó không nói được gì
về việc model THẬT có tra cứu thay vì đoán không, có nói thật khi thiếu công cụ
không, hay có tệ đi sau khi mình sửa persona không.

`pnpm eval` đo đúng phần đó. Đổi lại nó cần mạng, cần khóa thật, và tốn token - nên
chạy TAY trước khi phát hành, không nhét vào CI.

## Ba ràng buộc sống còn

1. **Không bao giờ chạm zca-js thật.** `runAgentTurn` nhận `api: API`, và các tool
   nhóm action gọi thẳng `enqueueSend`. Chạy với API thật là bot nhắn thật cho người
   thật. Runner TỰ dựng API giả (`fake-zalo-api.ts`), không nhận từ ngoài, và in ra
   số lời gọi đã chặn được ở cuối mỗi lần chạy.
2. **DB tạm.** `setupTestEnv()` chạy trước mọi `await import()` động - `database.ts`
   mở SQLite ở module scope, import sớm là mở nhầm DB thật.
3. **Khẳng định trên HÀNH VI, không trên câu chữ.** "Phải gọi `web_search`" thì ổn
   định; "câu trả lời phải chứa từ X" thì đỏ ngẫu nhiên. Bộ eval đỏ ngẫu nhiên là bộ
   eval người ta ngừng đọc, tức là mất luôn những lần đỏ thật.

## Thêm case

Sửa `eval-cases.ts`. Bắt buộc có `lyDo` - case không nêu được lý do tồn tại là case
người sau sẽ xóa nhầm lúc nó đỏ, hoặc tệ hơn: sửa mong đợi cho nó xanh mà không biết
mình vừa bỏ mất một hàng rào.

```ts
{
  ten: "ten-ngan",
  lyDo: "Vì sao case này tồn tại - kể cả sự cố đã từng xảy ra nếu có",
  tinNhan: "người dùng nhắn gì",
  disabledTools: ["create_image"],   // tắt tool đắt tiền nếu case không cần
  mongDoi: {
    goiTool: ["web_search"],         // PHẢI gọi (gọi thêm tool khác vẫn đạt)
    khongGoiTool: ["create_image"],  // TUYỆT ĐỐI không được gọi
    kiemTraText: { moTa: "...", dat: (t) => !t.includes("**") },
  },
}
```

`kiemTraText` CHỈ dùng cho tính chất cấu trúc (kết thúc bằng dấu hỏi, không chứa
`**`, độ dài dưới N). Cấm khẳng định trên nội dung ngữ nghĩa.

**Tắt tool đắt tiền** ở những case không cần chúng (`create_image`,
`create_word_document`, `create_excel_file`). Hai lý do, lý do thứ hai mới là chính:
tiền (một lần vẽ ảnh là tiền thật và 60-135 giây chờ), và ĐỘ ĐÚNG của phép đo - case
"định dạng" hỏi lập bảng mà để `create_excel_file` bật thì model đi tạo file rồi trả
một câu ngắn, khẳng định "không còn markdown" xanh mà chẳng đo được gì.

## Bốn cái bẫy đã dính, đừng dính lại

**Lượt hỏng bị chấm thành ĐẠT.** Bộ eval đi qua `processBatch` - đúng đường
production - mà hàm đó BẮT lỗi rồi nhắn câu "trục trặc kỹ thuật" thay vì ném. Lần
chạy thật đầu tiên router trả 404, và 3/5 case báo ĐẠT: `khong-tra-thua` mong "không
gọi tool nào" (lượt chết nên đúng là không), `cong-cu-hep` mong "trả lời dài hơn 10
ký tự" (câu báo lỗi dài hơn), `dinh-dang` mong "không markdown" (câu báo lỗi không
có). Xanh đúng lúc hệ thống hỏng là kiểu xanh giả nguy hiểm nhất. `phatHienLuotHong`
sinh ra để chặn: 0 token, hoặc câu trả lời trùng hằng số báo lỗi của production.

**Đọc cấu hình từ nguồn KHÁC production.** Model được cấu hình qua dashboard
(bảng `runtime_settings`), còn `.env` chỉ là lớp dự phòng và rất hay để lại giá trị
cũ. Bản đầu của bộ eval chỉ đọc `.env` nên gọi bằng tên model sai, router trả 404, và
tôi kết luận nhầm "bot đang hỏng" trong khi bot chạy hoàn toàn bình thường.
`read-real-llm-settings.ts` sinh ra để đọc đúng nguồn, theo đúng luật
`getEffectiveLlmSettings()`. Dòng đầu mỗi lần chạy in rõ nguồn nào thắng.

**Mong đợi mâu thuẫn với thiết kế.** Case đầu tiên hỏi "hôm nay thứ mấy" và đòi gọi
`get_datetime`. Nhưng system prompt CỐ Ý đã chứa sẵn ngày + thứ, nên gọi tool là thừa
- đúng thứ mà case `khong-tra-thua` phạt. Lần chạy thật bắt được mâu thuẫn đó. Giờ
tách làm hai: hỏi GIỜ (prompt cố ý không có) thì phải gọi tool, hỏi NGÀY thì không
được gọi. Bài học: trước khi viết mong đợi, đọc xem prompt đã cho model biết những gì.

## Phép thử cho chính bộ eval

Bộ eval không bắt được lỗi khi mình cố tình gây lỗi thì nó vô dụng. Cách kiểm: thêm
một dòng vào `BASE_PERSONA` bảo model đừng dùng công cụ, rồi chạy

```bash
EVAL_ONLY=gio-chinh-xac,tra-cuu pnpm eval
```

Cả hai phải ĐỎ với lý do "phải gọi X nhưng không gọi", và token phải KHÁC 0 (khác 0
nghĩa là lượt có chạy thật, chỉ là model không gọi tool - phân biệt với lượt chết).
Nhớ khôi phục persona sau khi thử.
