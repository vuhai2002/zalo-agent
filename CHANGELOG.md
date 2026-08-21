# Changelog

Các thay đổi đáng kể của zalo-agent. Định dạng theo
[Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số theo
[Semantic Versioning](https://semver.org/lang/vi/).

Bản `0.x` nghĩa là API và cấu hình còn có thể đổi giữa các bản minor.

## [Chưa phát hành]

### Thêm

- **Kênh thứ hai: tài khoản Zalo Bot chính thức.** Ngoài tài khoản Zalo cá
  nhân (qua `zca-js`), agent chạy được trên tài khoản bot chính thức của Zalo
  qua **Zalo Bot API** (`bot-api.zaloplatforms.com`) - **không có rủi ro bị
  khóa tài khoản**. Hai loại chạy chung một tiến trình, trộn lẫn tùy ý; chọn
  loại lúc tạo account trên trang Accounts, dán Bot Token thay vì quét QR.
  Server KIỂM token với Zalo trước khi lưu (gọi `getMe`), token sai thì không
  lưu gì cả - tránh dựng ra một account trông như đã xong mà không bao giờ
  chạy; lưu xong account tự khởi động lại ngay.

  Lấy token: mở Zalo, tìm OA "Zalo Bot Manager", chọn "Tạo bot" (tên bắt buộc
  bắt đầu bằng "Bot"), token được gửi vào tin nhắn Zalo.

  **Đây là sản phẩm KHÁC với Zalo OA API** - chính sách "7 ngày kể từ tương
  tác cuối" và biểu phí gửi tin là của OA API, không áp cho đường này.

  Kênh bot hẹp hơn về năng lực, và đó là giới hạn của NỀN TẢNG chứ không phải
  agent bị lỗi: dò 17 method trên API sống thì 13 cái trả 404 (không có
  `sendDocument`/`sendFile`/`setMessageReaction`/`getChat`...). Nên **7 trong
  14 công cụ bị chặn** trên kênh này (`send_file`, `create_word_document`,
  `create_excel_file`, `create_image`, `add_reaction`, `tag_member`,
  `get_group_info`), còn lại 7 công cụ chạy bình thường.
  Công cụ bị chặn được gỡ khỏi schema gửi model - model không biết chúng tồn
  tại nên không hứa hão, không tốn token mô tả, và prompt injection không dụ
  gọi được. Kèm theo đó persona được ghép một luật nói thẳng lý do và mời
  người nhắn chuyển qua tài khoản cá nhân, vì ẩn công cụ mà im lặng thì người
  ta tưởng agent hỏng. Trang Tools cũng hiện rõ lý do khi chọn một account bot.

  Tài khoản bot mặc định **đóng allowlist**, khác tài khoản cá nhân: nick cá
  nhân phải là bạn bè mới nhắn được, còn bot thì ai có link cũng nhắn được -
  mở sẵn là mời người lạ đốt token và thử prompt injection.

  Bot Token mã hóa AES-256-GCM như cookie Zalo. Token nằm trong ĐƯỜNG DẪN của
  API (`/bot{token}/{method}`) nên client che token ba lớp trong mọi chuỗi sắp
  vào thông điệp lỗi - không thừa: đã dựng lại được đường token đi từ trang lỗi
  của cổng trung gian vào dashboard và vào file log.

  Thêm lệnh `pnpm zalo-bot-check` để dò Bot API bằng token thật, in ra method
  nào sống method nào 404 - lần sau Zalo mở thêm method thì đo lại bằng một
  lệnh.

- **Kho tri thức**: nạp tài liệu (txt/md/docx/xlsx/pdf hoặc gõ tay) ở trang
  "Kho tri thức" trên dashboard, bot tra được nội dung qua tool `kb_search`
  (FTS5 + bm25, hợp nhất bằng RRF - chừa sẵn chỗ cho lớp vector đợt sau).
  REQUEST upload trả về ngay, không đợi xử lý xong. Đọc file + cắt đoạn chạy
  trong `worker_threads` riêng - không chặn bot khi trích xuất tài liệu nặng,
  và worker có HAI cầu dao: tài liệu độc quay CPU vô hạn bị `terminate()` cắt
  (luồng chính không bao giờ đứng chờ), tài liệu phình HEAP JS bị
  `resourceLimits` chặn ở trần RAM đặt trên dashboard ("Trần RAM cho một lượt
  trích xuất", mặc định 192 MB). Cần cả hai vì trần thời gian không chặn được
  thứ chết nhanh: `resourceLimits` mặc định của Node cho phép worker ăn tới 4
  GB, quá xa ngân sách 768 MB của container. Nói rõ PHẠM VI của cầu dao RAM để
  không ai tin quá: nó chỉ đo heap JS, KHÔNG đo bộ nhớ ngoài heap
  (`Buffer`/`TypedArray`) - đo được một worker trần 16 MB vẫn cấp phát trọn
  6.000 MB `Float64Array` rồi kết thúc bình thường - nên đường đọc PDF gần như
  nằm ngoài tầm nó; và vượt trần THƯỜNG cho một lỗi bắt được, nhưng có hình
  dạng cấp phát khiến V8 dừng hẳn tiến trình. Việc còn giữ nhịp bot là bước GHI
  `kb_chunks`/FTS xuống SQLite (chỉ luồng chính được mở kết nối DB) - chi phí
  bám theo TỔNG LƯỢNG CHỮ ghi xuống, không phải số đoạn: đo 3 tài liệu, hai
  tài liệu CÙNG 20MB nhưng số đoạn lệch nhau gấp 3 lần (23.164 và 68.986) chỉ
  lệch ~15% thời gian ghi; một tài liệu 1/3 dung lượng (6,7MB) nhưng SỐ ĐOẠN
  khớp tài liệu 20MB đầu tiên lại ghi đúng ~1/3 thời gian. Mỗi
  agent chỉ đọc được nguồn đã bật cho nó ở trang sửa agent - mặc định KHÔNG bật
  nguồn nào. File nạp lên bị kiểm chữ ký thật (magic bytes) cho docx/xlsx/pdf,
  không tin đuôi tên - txt/md không có chữ ký cố định nên chấp nhận mọi byte;
  lưu theo id sinh ra chứ không dùng tên người dùng đặt.
- Agent tự khai được bộ công cụ của mình (`agents.disabled_tools`), GIAO với bộ
  công cụ của tài khoản Zalo. Công cụ dùng được là phần không bên nào tắt - agent
  khai năng lực, tài khoản áp chính sách, không bên nào bật ngược lại được bên
  kia. Nhờ vậy dựng được nhiều vai khác bộ công cụ trên cùng một nick.
- Ngân sách token thật cho ngữ cảnh (`LLM_CONTEXT_WINDOW`, đặt riêng được cho
  từng agent). Trước nay chỉ chặn bằng SỐ TIN, mà một tin Zalo dài tùy ý. Vượt
  ngân sách thì bot bỏ bớt ảnh cũ trước, rồi mới bỏ tin cũ; thêm điều kiện dừng
  giữa lượt theo usage thật.
- Trang sửa agent riêng (`/agents/:id`) chia nhóm Danh tính / Model / Công cụ.
  Màn tạo agent rút còn hai ô, ID tự sinh từ tên.

- Chặn vòng lặp công cụ trong một lượt: ba bộ đếm riêng (lỗi giống hệt, cùng
  công cụ lỗi, công cụ đọc trả cùng kết quả). Trước đó chặn trên duy nhất là số
  bước, nên bot gọi mãi một công cụ hỏng vẫn đốt hết lượt rồi trả lời cụt.
- Phân loại lỗi nhà cung cấp thay vì thử lại mù: hết quota tôn trọng
  `Retry-After` thật, tràn ngữ cảnh cắt sâu hơn rồi thử lại, sai khóa hoặc chưa
  cấu hình thì KHÔNG thử lại và báo câu riêng - chờ bao lâu cũng không tự hết.
- Lớp làm sạch câu trả lời trước khi chữ ra Zalo: bỏ markdown (Zalo không
  render nên `**đậm**` hiện nguyên ký tự), chặn hẳn câu lộ chỉ dẫn nội bộ, bỏ
  nhãn `[SILENT]` lọt vào chat thường. Giữ nguyên gạch đầu dòng, dấu sao giữa
  số và dấu tiếng Việt.
- `pnpm eval` - bộ kiểm thử chạy MODEL THẬT, khẳng định trên hành vi (gọi công
  cụ nào) chứ không trên câu chữ. Khác `pnpm test` ở mục đích: model giả không
  nói được gì về việc model thật có tra cứu thay vì đoán không.
- Luật hỏi lại khi thiếu thông tin (12-Factor #7): bot hỏi lại trước việc làm
  xong mới biết sai, gom hết thứ còn thiếu vào một câu, và KHÔNG hỏi vặn khi
  yêu cầu đã đủ rõ.
- Dải cảnh báo trên trang Tổng quan khi chưa cấu hình LLM - trước đó bot vẫn
  khởi động bình thường nên dashboard xanh trong khi mọi tin nhắn đều hỏng.
- Rootfs của container chạy `read_only`: mọi đường ghi của bot đều nằm trong
  volume dữ liệu, nên bật được. Bot đọc tin của người lạ, nên chặn ghi vào cây
  code và `node_modules` là một lớp phòng thủ thật chứ không phải hình thức.
- **Triển khai bằng Docker**: `Dockerfile` bốn stage (runner chỉ có dependency
  production, chạy bản biên dịch chứ không mang theo TypeScript),
  `docker-compose.prod.yml`, `deploy.sh` có kiểm tra sức khỏe, và
  `docs/deployment-guide.md`. Toàn bộ trạng thái nằm trong MỘT volume - bot
  không cần cơ sở dữ liệu ngoài.
- Thêm `DASHBOARD_HOST` (mặc định `127.0.0.1`). Trước đó địa chỉ lắng nghe bị
  ghi cứng, mà `127.0.0.1` bên trong container là loopback của chính container
  nên reverse proxy chỉ nhận connection refused - Docker sẽ hỏng câm. Việc chặn
  phơi ra internet chuyển sang phía host bằng publish `127.0.0.1:<host>:<container>`.
- **Xóa sạch ngữ cảnh một cuộc trò chuyện** từ trang Sessions: tin nhắn, bản
  tóm tắt, trace từng bước, ảnh đã tải và mô tả ảnh. Ô tick riêng để xóa thêm
  những điều bot đã ghi nhớ học được trong cuộc trò chuyện đó. Lịch hẹn đang
  chờ và tên hiển thị vẫn giữ - đây là "reset" chứ không phải xóa hội thoại.
  Mỗi lần xóa còn mở một phiên cache MỚI với router, để nó không giữ tiền tố
  của cuộc trò chuyện vừa bỏ đi.
  Lịch sử token KHÔNG bị đụng: nó là sổ chi tiêu, không phải nội dung hội thoại.
- **Google (Gemini) thành nhà cung cấp hạng nhất** (`LLM_PROVIDER=google`, hoặc
  chọn ở trang Cấu hình). Trước đây Gemini chỉ dùng được qua lớp giả OpenAI của
  Google, mà lớp đó làm rơi `thought_signature` nên mọi lượt CÓ GỌI CÔNG CỤ đều
  chết bằng 400 - chat chay thì vẫn sống, nên lỗi rất khó đoán. Nút chọn nhanh
  trỏ vào lớp giả đã bị bỏ, và ai còn cấu hình cũ sẽ thấy cảnh báo ngay trên
  form kèm cách sửa. Base URL sót lại của hãng khác bị bỏ qua thay vì gửi khóa
  Google sang bên thứ ba.

- **Nhiều người trong nhóm nhắn cùng lúc thì mỗi người nhận một câu trả lời
  riêng**, trích đúng tin của mình - thay vì gộp cả nhóm vào một câu như trước.
  Một người nhắn nhiều tin liên tiếp (ảnh rồi chú thích) vẫn gộp làm một lượt,
  đó vốn là lý do bộ gộp tồn tại. Các lượt chạy nối tiếp nhau nên lịch sử cuộc
  trò chuyện không bị chồng chéo.
- Trả lời trong nhóm kèm **trích dẫn tin người hỏi** - Zalo hiển thị khối trích
  dẫn ngay trên câu trả lời nên nhiều người cùng hỏi vẫn biết bot đang trả lời
  tin nào. Trích tin mở lượt; chỉ đoạn đầu của câu trả lời dài mới trích. Chat
  riêng không trích (hai người thì trích là nhiễu). Loại tin Zalo không cho
  trích, hoặc tin được trích quá dài so với ngân sách, thì gửi bình thường
  không kèm - trích dẫn không bao giờ được phép làm mất chữ.
- **Lịch hẹn chạy được trên tài khoản Zalo Bot.** `schedule_task` và trang Lịch
  hẹn giờ dùng được cho cả hai loại kênh. Trước đây nó nằm trong bảng chặn của
  kênh bot và là mục DUY NHẤT ở đó không dẫn được một số đo 404 nào: Bot API
  gửi chủ động tốt (đo thật 10 tin trong 416ms), chỉ là bộ hẹn lịch khóa cứng
  vào `zca-js` nên tài khoản bot không bao giờ có đường gửi. Scheduler giờ dựng
  đường gửi theo KÊNH, nên hai loại tài khoản đi chung đúng một đường.

  Sửa kèm hai lỗi cùng gốc: (1) thông báo "đã chạm trần tin chủ động hôm nay"
  trước đây KHÔNG BAO GIỜ tới được tài khoản bot - hỏng câm, vì đường gửi thông
  báo đó cũng dựng bằng tay theo zca-js; (2) trên kênh bot, `styles` bị tính
  vào ngân sách byte của bộ cắt tin rồi lại bị đường gửi vứt đi, làm câu trả
  lời dài bị chẻ thừa tin.

  Job của tài khoản bot lúc tạm dừng giờ GIỮ NGUYÊN suất chạy và thử lại ở tick
  sau, thay vì bị tắt hẳn như trước.

  **Nếu bạn đã chạy bản trước và có job lịch hẹn của tài khoản bot bị tắt hẳn**
  (chỉ ảnh hưởng job tạo trong ngày 2026-08-11):

  Cách nhận ra chúng - hai loại lịch hiện HAI nhãn khác nhau, đừng chỉ tìm một:
  job `every`/`cron` hiện **"Đã tắt"**, còn job **một lần** hiện
  **"Đã xong (chạy đủ 1 lần)"**. Nhãn thứ hai NÓI DỐI: job đó chưa gửi gì cả -
  bản cũ vừa tắt job vừa cộng số lần chạy, nên giao diện tưởng nó đã hoàn thành.
  Dấu hiệu đúng nằm ở badge trạng thái bên cạnh: **"Bị bỏ lượt"**.

  Rồi làm ĐÚNG BA BƯỚC theo thứ tự:

  1. Mở **Sửa** của job đó và **ĐỔI mốc thời gian** - đổi thật, sang một
     mốc khác. Lưu mà giữ nguyên lịch cũ thì không có tác dụng gì: giao diện
     chỉ gửi phần lịch khi nó thực sự đổi.
  2. **Lưu.**
  3. **Bật công tắc** của job. Bước này bắt buộc và phải làm SAU bước 2 - bản cũ
     xóa cả mốc hẹn lẫn cờ bật, mà sửa lịch chỉ trả lại mốc chứ không bật lại
     job. Trước bước 2 thì công tắc còn đang bị vô hiệu hóa.

  Với job loại `once` thì mốc gốc đã nằm trong quá khứ nên hệ thống từ chối -
  phải chọn một mốc mới, không khôi phục lại đúng lời hẹn cũ được.


- **Bot không còn đặt trùng lịch khi người dùng cảm ơn.** Ca thật: sau khi bot
  đặt lịch xong và báo lại, người dùng nhắn "okay cảm ơn bạn" - bot tạo thêm
  một lịch y hệt, tới giờ người dùng nhận hai tin. Nguyên nhân: lịch sử hội
  thoại chỉ lưu CHỮ, không lưu lời gọi công cụ, nên sang lượt sau model không
  có bằng chứng nào là nó đã đặt lịch; trace cho thấy nó định "kiểm tra" mà
  công cụ duy nhất trong tầm với là "đặt lịch" - thế là đặt lại.

  Giờ `schedule_task` nhận ra lịch trùng (cùng cuộc trò chuyện, cùng loại,
  cùng mốc giờ, cùng tên) và trả về lịch đã có thay vì tạo thêm. Hai việc KHÁC
  nhau vào cùng một giờ vẫn đặt được bình thường, và bot được nhắc để nói cho
  bạn biết là đã có lịch khác cùng mốc. Mô tả công cụ cũng dạy model dùng
  "xem danh sách" để kiểm tra thay vì đặt lại cho chắc.

### Sửa

- **Dashboard trên màn hình thấp**: ba lỗi cùng một họ, chỉ lộ ra khi cửa sổ
  thấp hơn ~770px (laptop 1080p ở zoom 125% là chạm ngưỡng này).
  - Sidebar không có trần chiều cao nên đẩy cả trang cuộn theo: cuộn xuống là
    sidebar trôi lên mất logo, và có hai thanh cuộn dọc chồng nhau. Sau khi
    sửa: trang không tự cuộn nữa, sidebar đứng yên, danh sách mục cuộn riêng.
  - Bốn hộp thoại (Thêm nguồn tri thức, Tạo agent, Login QR, hộp xác nhận)
    tràn khỏi màn mà KHÔNG cuộn được - lớp phủ là `fixed` nên cuộn trang cũng
    không kéo vào. Ở cửa sổ thấp thì không thêm được nguồn tri thức và không
    tạo được agent vì nút bấm nằm ngoài màn hình. Nay cả bốn có trần chiều cao
    và vùng cuộn nội bộ.
  - Cột danh mục trang Cấu hình nay GHIM lại khi cuộn nội dung bên phải, thay
    vì cuộn đi mất để lại một khoảng trống lớn. Mốc ghim tính theo chiều cao
    thật của danh mục nên màn cao thì ghim ở đỉnh, màn thấp thì danh mục trôi
    lên tiếp cùng nội dung cho tới khi hết danh sách mới dừng - không sinh
    thêm thanh cuộn nào.
- Tin nhắn của người dùng vào lịch sử **ngay lúc nhận** thay vì cuối lượt. Nhờ
  vậy thứ tự trong dữ liệu luôn là thứ tự tin tới, và lượt hỏng giữa chừng
  không còn đánh rơi câu người ta vừa nói. Tin do bot gửi kèm file/ảnh cũng ghi
  ngay lúc gửi. Đây là nền cho việc cho bot trả lời nhiều người song song trong
  nhóm.
- Bot hiểu sai giờ của câu vừa hỏi: tin trong lịch sử có nhãn `[ngày/tháng
  giờ:phút]` còn tin của lượt đang chạy thì không, nên mốc giờ mới nhất model
  thấy luôn là của tin TRƯỚC ĐÓ. Vắt qua nửa đêm là nó tin câu hỏi lúc 00:12
  được gửi từ hôm trước. Nay mỗi tin mang đúng giờ NGƯỜI TA GỬI (đọc từ payload
  Zalo), dùng chung cho cả nhãn model đọc lẫn `created_at` lưu xuống - một
  nguồn nên hai chỗ không lệch được. Sửa luôn chuyện `created_at` trước nay là
  giờ KẾT THÚC lượt, lệch vài phút với lượt dài.
- Nhãn giờ trong lịch sử đọc giờ của MÁY chạy bot thay vì "Múi giờ của bot" trên
  dashboard - nơi duy nhất trong mã nguồn qua mặt được setting đó. Trên máy dev
  (múi Việt Nam) đúng do trùng hợp; trong container Docker (chạy UTC) thì lệch 7
  tiếng so với dòng "Hôm nay là..." trong cùng một prompt.
- Nhiều người cùng nhắn trong một nhịp gộp thì lời của người trước bị gán cho
  người sau: bộ gộp gom theo cuộc trò chuyện chứ không theo người gửi, mà phần
  chữ lại nối phẳng rồi dán một cái tên. Nay mỗi tin một dòng, mỗi dòng mang tên
  người viết chính dòng đó.
- Đổi sang DeepSeek là bot câm mọi tin nhắn: schema của `schedule_task` đặt
  `z.discriminatedUnion` ở nút GỐC, dịch ra `oneOf` không kèm khóa `type`, mà
  DeepSeek đòi `parameters.type` phải là `"object"` nên chối cả request. Đi vòng
  qua 9router không cứu được - đường openai-compatible chuyển tiếp schema nguyên
  xi. Nay schema gửi ra là object phẳng, ràng buộc theo action ép lại trong
  `execute` để model đọc được câu lỗi và tự gọi lại thay vì chết cả lượt. Bẫy
  thứ ba cùng họ với `z.tuple()` và enum số; bộ quét schema nay có thêm luật gốc
  phải là `type: "object"`.
- Bộ eval đo một stack tra cứu KHÁC bot thật: nó chạy DB tạm nên mất cấu hình
  tìm kiếm của dashboard và rơi về DuckDuckGo, trong khi bot chạy Brave. Ngày
  DuckDuckGo trả 0 kết quả, case nghiên cứu đỏ với lý do "không gọi web_fetch" -
  chẩn đoán sai hoàn toàn. Nay eval chép cấu hình tra cứu từ DB thật, và DỪNG
  HẲN kèm câu chỉ đúng bệnh nếu dịch vụ tìm kiếm trả 0 kết quả.
- Tóm tắt tin tức ra toàn ý chung chung không số liệu: bot tìm kiếm xong là
  viết luôn từ đoạn trích, chưa mở bài nào. Thêm luật buộc `web_fetch` ít nhất
  một bài trước khi tóm tắt, mỗi ý phải neo được vào bài đã đọc. Đo A/B trên
  model thật: có luật 3/3 lần mở bài, bỏ luật 3/3 lần không mở.
- Số bước tối đa mỗi lượt mặc định lên **10** (trước là 8): một lượt nghiên cứu
  tiêu 6-8 bước chỉ để tìm là hết bước, chưa kịp đọc. Kèm hệ quả tốt - ngưỡng
  chặn vòng lặp `TOOL_LOOP_SAME_TOOL_BLOCK=8` nay nằm dưới trần nên tự nổ được,
  trước đó nó đứng đúng bằng trần và không bao giờ tới lượt.
- Cấp tiêu đề của tool tạo file Word khai bằng union literal SỐ, dịch ra
  `const: 1` rồi được provider Google gộp thành `enum: [1]` - mà `Schema.enum`
  của Google chỉ nhận chuỗi, nên chối cả request bằng 400. Cùng họ với lỗi
  `z.tuple()` ở ô công thức Excel. Đổi sang khoảng số; bộ quét schema nay kiểm
  cả `const` lẫn `enum` chứ không riêng `items`.
- Đổi ô "Kiểu kết nối" ở trang Cấu hình không dọn Model và Base URL của nhà
  cung cấp cũ, nên lưu được tổ hợp vô nghĩa (Anthropic + tên model của Gemini)
  và bot chết ở lượt kế tiếp. Nay đổi nhà cung cấp là dọn cả hai ô; quay VỀ nhà
  đang lưu thì khôi phục nguyên giá trị đã lưu.
- Base URL của nhà cung cấp cũ nằm lại trong DB vĩnh viễn khi chuyển sang
  Anthropic hoặc Google, rồi hiện lại lúc quay về - đọc ra như dashboard hỏng.
  Lớp cấu hình nay phân biệt "giữ nguyên" (bỏ trường) với "xóa hẳn" (null).
- Một lỗi 4xx bất kỳ trên cuộc trò chuyện TỪNG có ảnh bị quy cho ảnh, khiến bot
  ghi nhớ nhầm "model không đọc được ảnh" rồi bỏ pixel suốt 10 phút sau đó. Nay
  đường gọi thẳng hãng (Anthropic, Google) không bao giờ bị đánh dấu - Claude và
  Gemini đều đọc được ảnh, nên 4xx ở đó chắc chắn là chuyện khác.
- Chọn Google Gemini làm nhà cung cấp LLM thì bot CÂM HOÀN TOÀN: mọi tin nhắn
  chết bằng HTTP 400 trước khi model kịp nghĩ gì. Căn nguyên là `z.tuple()`
  trong schema của `create_excel_file` - nó dịch ra JSON Schema draft-07 với
  `items` là một MẢNG, trong khi lớp OpenAI-compatible của Google chỉ nhận
  2020-12 (`items` phải là object hoặc boolean) nên chối cả request. Vì bộ tool
  đi kèm mọi lượt nên lỗi không giới hạn ở lượt nào nhờ làm Excel. Đổi sang
  `z.array().length(2)`: ràng buộc lúc chạy y hệt, JSON Schema thì mọi nhà cung
  cấp đều nhận. Thêm test quét cấu trúc schema của cả 13 tool để lỗi cùng lớp
  đỏ ngay tại chỗ thay vì nằm im tới lúc ai đó đổi nhà cung cấp.
- Vẽ ảnh hụt thì bỏ cuộc ngay, dù gọi lại là gần như chắc được. Nhà cung cấp
  chạy xong mà không đẻ ra ảnh nào là hành vi KHÔNG XÁC ĐỊNH (model upstream tự
  quyết có gọi tool vẽ hay không), khác hẳn sai khóa hay hết quota. Nay lớp lỗi
  đó được phân loại riêng và vẽ lại đúng một lần, có nhắn cho người dùng biết
  là đang vẽ lại - lần hụt đo được đã ngốn 130 giây, thử lại âm thầm là bắt họ
  ngồi im gần 4 phút sau một lời hứa 3 phút. Lần vẽ lại KHÔNG trừ thêm suất
  trong trần ảnh mỗi giờ. Quá hạn, mất tín hiệu, sai khóa, hết quota vẫn không
  thử lại: gọi lại chỉ tốn thêm thời gian chứ không đổi kết cục.
- Ô chọn nhà cung cấp của agent gửi API key của router thẳng sang endpoint của
  bên khác: `resolveLanguageModel` chỉ đổi provider và model, còn key luôn lấy
  từ cấu hình chung. Vừa lộ khóa sang bên thứ ba vừa làm bot câm vì 401. Nay
  override nhà cung cấp lệch bị bỏ qua ngay tại chỗ dựng client.
- Trang Tools hiện trạng thái ngược với bộ công cụ model thật nhận (công tắc ở
  đó chỉ nói lớp tài khoản).
- Rời trang sửa agent khi còn thay đổi chưa lưu thì mất trắng, không hỏi.
- Gõ nhầm một chữ vào ô số bước làm mất âm thầm giới hạn bước của agent.

- Kết quả HỎNG của công cụ nay có đánh dấu máy đọc được nên bộ chặn vòng lặp
  đếm được chúng; trước đó hai trong ba bộ đếm là code chết vì không công cụ
  nào ném lỗi. Trang Trace cũng tô đỏ nhánh hỏng thay vì hiện như kết quả thường.
- Lưu trang Providers với ô Model để trống làm mất luôn API key vừa nhập.
### Đổi

- **Trần 8 MB chữ trích ra từ một file Word/Excel nay tính cho CẢ FILE, trước
  đó tính cho MỖI SHEET.** Một workbook nhiều sheet mà tổng chữ vượt 8 MB giờ bị
  từ chối với câu "Chữ trích ra từ file vượt quá giới hạn 8 MB - hãy tách thành
  nhiều file nhỏ hơn", dù trước đây nạp được. Đây là sửa lỗi an toàn, không phải
  siết cho vui: đo được một file .xlsx chỉ 3,9 KB (12 sheet, 996 ô, lọt mọi trần
  khác) trích ra 95 MB chữ vì mỗi sheet đều dưới trần khi tính riêng. Cách xử lý
  cho file thật chạm trần: tách bớt sheet sang file khác rồi nạp thành nhiều nguồn.
- `pnpm test` quét cả `web/src` - cây này trước đó không có test nào.
- `.env.example` từ 68 biến còn 13. Gần như mọi tham số đã có trên dashboard và
  dashboard ĐÈ `.env`, nên danh sách dài kia vừa thừa vừa gây hiểu nhầm: giá trị
  cũ nằm lại trong `.env` trong khi DB đang gánh. `LLM_MODEL` và `LLM_BASE_URL`
  hết bắt buộc - cài mới giờ chỉ cần điền `CREDENTIALS_ENCRYPTION_KEY`, phần còn
  lại nhập trên dashboard. **Nâng cấp không cần làm gì**: `.env` cũ vẫn chạy y hệt.

## [0.1.0] - 2026-08-02

Bản đầu tiên được đánh số. Gom toàn bộ những gì đã làm từ đầu dự án.

### Tính năng

- **Bot Zalo đa tài khoản**: nhiều account chạy chung một process, mỗi account
  một "não" (agent) riêng - persona, model, số bước tối đa đặt độc lập
- **Agent loop tự viết** trên Vercel AI SDK, LLM gọi qua router proxy nên đổi
  nhà cung cấp bằng biến môi trường, không sửa code
- **13 công cụ**: tra ngày giờ, tìm kiếm web (DuckDuckGo miễn phí, Brave nếu có
  key), đọc trang web, thả cảm xúc, gửi file, tag thành viên, xem thông tin
  nhóm, đọc ảnh, vẽ ảnh, ghi nhớ lâu dài, tạo file Word/Excel, đặt lịch hẹn
- **Trí nhớ 3 lớp**: lịch sử gần, tóm tắt phần đã trôi, và fact bền do bot tự
  ghi - bật/tắt từng công cụ theo account
- **Lịch hẹn**: bot tự nhắn theo lịch `once`/`every`/`cron`, đặt qua chat hoặc
  dashboard. Hai lớp chống spam độc lập vì đây là tính năng rủi ro khóa nick
  cao nhất: chặn lịch lặp quá dày lúc TẠO, và trần tin chủ động mỗi ngày lúc GỬI
- **Dashboard web**: xem hội thoại, contacts, trí nhớ, trace từng bước của agent,
  log hệ thống, bật/tắt bot theo cuộc trò chuyện, đổi nhà cung cấp LLM
- **Trang Cấu hình**: 46 tham số trước đây chỉ sửa được trong `.env` rồi khởi
  động lại, giờ chỉnh trực tiếp và có hiệu lực ngay
- **Đổi mật khẩu dashboard** từ web, lưu dạng hash; đổi xong thu hồi mọi phiên
  đăng nhập khác
- **Chế độ tối** kèm ảnh nền riêng, nhớ lựa chọn giữa các lần mở

### Bảo mật

- Cookie Zalo mã hóa AES-256-GCM trên đĩa
- Chặn IDOR ở tầng lưu trữ cho lịch hẹn: đọc/sửa/xóa đều bắt buộc khớp cả
  account lẫn cuộc trò chuyện
- Chỉ tải được URL trỏ tới IP công cộng - chặn loopback, mạng nội bộ và
  endpoint metadata của cloud (phòng prompt injection lừa bot đọc dịch vụ nội bộ)
- Nội dung lấy từ web được bọc trong khối đánh dấu rõ là DỮ LIỆU, không phải
  mệnh lệnh; tin của người ngoài danh sách cho phép có nhãn riêng
- Rate limit đăng nhập dashboard, phiên lưu trong DB nên đăng xuất thu hồi được thật

[Chưa phát hành]: https://github.com/vuhai2002/zalo-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vuhai2002/zalo-agent/releases/tag/v0.1.0
