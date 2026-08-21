<p align="center"><strong>zalo-agent</strong></p>

<p align="center">
Agent AI thường trú trên Zalo. Chạy được trên <strong>hai loại kênh</strong>: tài khoản Zalo <strong>cá nhân</strong> (qua zca-js)<br/>
và tài khoản <strong>Zalo Bot chính thức</strong> (qua Zalo Bot API). Nhiều account chạy chung một tiến trình,<br/>
mỗi account một "não" riêng, 14 công cụ, dashboard web đầy đủ. Tự host, không phụ thuộc nhà cung cấp LLM nào.
</p>

<p align="center">
  <a href="#cài-đặt">Cài đặt</a> •
  <a href="#hai-loại-kênh">Hai loại kênh</a> •
  <a href="#agent-làm-được-gì">Tính năng</a> •
  <a href="#dashboard">Dashboard</a> •
  <a href="#an-toàn---đọc-trước-khi-chạy">An toàn</a> •
  <a href="docs/system-architecture.md">Kiến trúc</a> •
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node-22.13+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/SQLite-node:sqlite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/AI_SDK-Vercel-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel AI SDK" />
  <img src="https://img.shields.io/badge/tests-2174%20xanh-brightgreen?style=flat-square" alt="tests" />
</p>

---

Luồng một lượt: **tin Zalo -> lọc (allowlist, @mention) -> gộp theo thread -> agent loop (LLM tự
gọi tool) -> làm sạch + dịch định dạng -> cắt theo trần byte -> gửi**.

Không có bước nào chạy code do model sinh ra. Nội dung lấy từ web luôn bị bọc trong thẻ đánh dấu
là dữ liệu, không phải mệnh lệnh.

## Hai loại kênh

Một tiến trình chạy được cả hai loại tài khoản cùng lúc, trộn lẫn tùy ý. Chọn loại **lúc tạo
account** trên dashboard, không đổi được sau đó.

| | Tài khoản cá nhân | Tài khoản Zalo Bot chính thức |
|---|---|---|
| Thư viện / API | [`zca-js`](https://github.com/RFS-ADRENO/zca-js) (**không chính thức**) | **Zalo Bot API** - `bot-api.zaloplatforms.com` (chính thức) |
| Đăng nhập | quét QR ngay trên dashboard | dán **Bot Token** vào dashboard |
| Nhận tin | WebSocket listener + tự kết nối lại | long polling `getUpdates` |
| Rủi ro khóa tài khoản | **có** - chỉ dùng nick phụ | **không** |
| Ai nhắn được | phải là bạn bè | ai có link cũng nhắn được |
| Công cụ dùng được | đủ **14** | **7 trong 14** (xem bảng dưới) |
| Định dạng chữ | định dạng gốc Zalo (`textProperties`) | chữ trơn |
| Trần một tin | theo cấu hình (mặc định 2000 ký tự) | 2000 ký tự, server ép cứng |
| Gửi file / ảnh / thả cảm xúc / tag | có | **không có method trên API** |
| Lịch hẹn | có | có |
| Allowlist mặc định | mở | **đóng** (`mode: "list"`) |

> [!IMPORTANT]
> **Zalo Bot API KHÁC Zalo OA API.** Hai sản phẩm này bị nhầm lẫn khắp nơi, kể cả trong tài liệu
> bên thứ ba. Chính sách "chỉ được nhắn trong 7 ngày kể từ tương tác cuối" và biểu phí gửi tin là
> của **OA API** (`openapi.zalo.me`), **không** áp cho Bot API mà dự án này dùng.

### Tạo tài khoản Zalo Bot

1. Mở Zalo, tìm Official Account **"Zalo Bot Manager"**.
2. Chọn **"Tạo bot"** (mở mini app Zalo Bot Creator). Tên bot **bắt buộc bắt đầu bằng "Bot"**.
3. Token được gửi vào tin nhắn Zalo cho bạn.
4. Dashboard > **Accounts** > Thêm account > Loại kênh = **Tài khoản bot chính thức** > dán token.

Server **kiểm token với Zalo trước khi lưu** (gọi `getMe`) - token sai thì không lưu gì cả, tránh
dựng ra một account trông như đã cấu hình xong mà không bao giờ chạy. Lưu xong account tự khởi
động lại ngay.

### Vì sao 7 công cụ không chạy trên kênh Bot

Không phải chọn cho an toàn - là **đo trên API sống**: dò 17 method, 13 cái trả
`{"ok":false,"description":"Not Found","error_code":404}`. Không tồn tại
`sendDocument` / `sendFile` / `sendVideo` / `sendAudio` / `editMessageText` / `deleteMessage` /
`setMessageReaction` / `forwardMessage` / `getChat` / `getChatMember`.

Những công cụ đó bị **gỡ khỏi schema** gửi cho model (model không biết chúng tồn tại, không tốn
token mô tả, không thể bị prompt injection dụ gọi) **và** persona được ghép thêm một luật nói rõ
đây là giới hạn nền tảng chứ agent không hỏng - ai nhờ thì agent trả lời thẳng là tài khoản bot
không gửi được, mời nhắn qua tài khoản cá nhân. Ẩn công cụ mà không nói lý do thì người nhắn
tưởng agent bị lỗi.

> Trước đây danh sách này có **8** công cụ - `schedule_task` nằm trong đó. Nó là mục duy nhất
> không dẫn được một số đo 404 nào: Bot API gửi chủ động tốt (đo: 10 tin trong 416ms), chỉ là
> bộ hẹn lịch khóa cứng vào `zca-js` nên tài khoản bot không có đường gửi. Đã nối ở V3.19.

## Agent làm được gì

14 công cụ, bật/tắt từng cái theo account ngay trên dashboard.

| Công cụ | Làm gì | Kênh Bot |
|---|---|---|
| `web_search` | Tìm web theo chuỗi nguồn (Brave -> DuckDuckGo). DuckDuckGo không cần key | có |
| `web_fetch` | Đọc 1 URL công khai. Chặn IP nội bộ và metadata cloud (chống SSRF) | có |
| `kb_search` | Tra tài liệu chủ agent tự nạp (chính sách, bảng giá, hướng dẫn) - FTS5 + bm25, hợp nhất bằng RRF | có |
| `save_memory` | Ghi nhớ lâu dài về người dùng, sống qua nhiều phiên chat | có |
| `get_datetime` | Ngày giờ chính xác theo múi giờ cấu hình | có |
| `read_image` | Nhìn kỹ lại ảnh với câu hỏi cụ thể: đếm số lượng, đọc chữ nhỏ, soi chi tiết | có |
| `create_image` | Vẽ ảnh AI mới, hoặc **SỬA ảnh người dùng vừa gửi** - phần còn lại giữ nguyên từng pixel | không |
| `create_word_document` | Soạn .docx (tiêu đề, đoạn văn, bảng, hai cột) rồi gửi thẳng trong chat | không |
| `create_excel_file` | Soạn .xlsx nhiều sheet, **có công thức kèm sẵn kết quả** nên xem trước trên điện thoại vẫn thấy số | không |
| `send_file` | Gửi file từ kho `data/shared-files/` hoặc tải từ URL công khai | không |
| `schedule_task` | Đặt/xem/sửa/hủy lịch để agent tự nhắn lại đúng cuộc trò chuyện này | có |
| `tag_member` | @mention đúng người trong nhóm | không |
| `get_group_info` | Tên nhóm, số thành viên, danh sách thành viên | không |
| `add_reaction` | Thả cảm xúc vào tin nhắn | không |

Bộ công cụ thật của một lượt là **phần giao** giữa hai danh sách tắt: **agent** khai năng lực
("vai này biết làm gì"), **account** áp chính sách ("nick này được phép làm gì"). Không bên nào
bật ngược lại được bên kia, nên thêm một agent mới không bao giờ nới rộng quyền của một nick.

Lượt chạy theo lịch còn hẹp hơn nữa: **9 công cụ bị loại** khỏi lượt đó, vì lượt theo lịch chạy cô
lập khỏi lịch sử chat và 5 trong số đó gửi thẳng ra Zalo, né mất trần "số tin chủ động mỗi ngày".

### Tin nhắn có định dạng thật

Trên kênh cá nhân, agent không trả về một khối chữ phẳng. Markdown của model được **dịch** thành
định dạng gốc của Zalo (`textProperties`), không phải bị xóa đi:

- **In đậm**, *in nghiêng*, ~~gạch ngang~~, gạch chân, tiêu đề cỡ lớn
- **Bốn màu chữ** (đỏ, cam, vàng, xanh lá) cho thư mời và thông báo trang trọng
- Emoji dẫn dòng chọn theo đúng nghĩa của dòng

Toàn bộ đã **đo trên máy thật, cả Zalo Web lẫn Zalo điện thoại** - hai client render khác nhau
ở vài chỗ, và những chỗ đó đã bị loại khỏi thiết kế. Zalo còn từ chối cả tin khi chữ cộng định
dạng vượt một ngưỡng byte, nên bộ gửi tự co trần ký tự cho vừa ngân sách rồi mới cắt.

Kênh Bot gửi **chữ trơn** - không phải vì sợ lỗi, mà vì chữ tới đường gửi đã hết markdown rồi
(lớp dịch đã bóc dấu ra thành `Style[]` ở tầng trên), nên xin server dựng lại chỉ có thể bớt ký tự.

### Kho tri thức (RAG)

Nạp tài liệu để agent tra cứu bằng công cụ `kb_search` - chính sách công ty, bảng giá, hướng dẫn
nội bộ, FAQ.

- Định dạng: **.docx, .xlsx, .pdf, .txt, .md** hoặc gõ tay thẳng trên dashboard
- Tìm bằng **SQLite FTS5 + bm25**, hợp nhất nhiều truy vấn bằng **RRF** (chừa sẵn chỗ cho lớp vector sau)
- Nội dung nạp bằng **công cụ**, KHÔNG nhét sẵn vào prompt - giữ nguyên khoản đầu tư prompt cache
  của những lượt không đụng tới kho
- Mỗi agent chỉ đọc được nguồn **đã gán tường minh** cho nó. Mặc định **không** nguồn nào
- Kiểm **chữ ký thật của file** (magic bytes) cho docx/xlsx/pdf, không tin đuôi tên
- Đọc file + cắt đoạn chạy trong **worker thread riêng**, có hai cầu dao: tài liệu quay CPU vô hạn
  bị `terminate()` cắt, tài liệu phình heap bị chặn bằng trần RAM đặt trên dashboard
- Đọc docx/xlsx bằng **SAX theo luồng**, không phải regex bắt cặp thẻ: đo được cặp regex cũ khóa
  cứng event loop **38,09 giây** trên một bom XML 1,7 KB nén (ReDoS bậc hai). Số đó nằm trong test
  hồi quy

### Lịch hẹn (agent tự nhắn)

Ba loại lịch: `once`, `every`, `cron`. Đặt bằng lời ngay trong chat hoặc trên dashboard.

- Loại `message`: gửi nguyên văn, **0 token**
- Loại `agent`: chạy một lượt AI riêng, cô lập khỏi lịch sử chat (tra cứu rồi báo cáo)
- Hai lớp chống spam: chặn lịch lặp quá dày lúc tạo, và trần số tin chủ động mỗi ngày
- Lịch trễ vẫn GỬI kèm nhãn "(nhắc trễ, lịch gốc HH:MM)" thay vì im lặng nuốt
- Không nhận chuỗi ngày giờ dạng tự do - chỉ `{date, time}` rời hoặc `{inMinutes}`, vì chuỗi naive
  qua `new Date()` bị hiểu theo giờ hệ điều hành. Mọi quy đổi múi giờ đi qua một đường duy nhất

### Trí nhớ

- Lịch sử hội thoại trong SQLite, theo account + thread
- **Rolling summary**: phần rơi khỏi cửa sổ replay được tóm tắt lại chứ không mất
- **Ngân sách token thật** cho ngữ cảnh (đặt riêng được cho từng agent), không chỉ đếm số tin -
  vượt ngân sách thì bỏ ảnh cũ trước, rồi mới bỏ tin cũ
- **Fact bền** qua `save_memory`, có luật riêng tư bất đối xứng giữa chat riêng và nhóm
- Ảnh nhận được lưu lại, mô tả bằng model vision phụ và cache lại để lượt sau khỏi trả tiền lần nữa

## Dashboard

Hono + React + Tailwind, phục vụ ngay từ chính tiến trình agent tại `http://127.0.0.1:3900`.

| Trang | Dùng để |
|---|---|
| Tổng quan | Token vào/ra theo ngày, gộp mọi account |
| Accounts | Thêm tài khoản Zalo, chọn **loại kênh** (cá nhân / bot chính thức), **quét QR login ngay trên web** hoặc dán **Bot Token**, bật/tắt từng account |
| Agents | Mỗi account một "não": persona riêng, model riêng, bộ công cụ riêng, nguồn tri thức riêng |
| Sessions | Đọc lại từng cuộc trò chuyện, xem tóm tắt agent tự dựng, bật/tắt agent theo thread, **xóa sạch ngữ cảnh** một cuộc trò chuyện |
| Contacts | Danh bạ đã gặp |
| Memory | Xem, sửa, xóa từng điều agent đã nhớ |
| Kho tri thức | Nạp tài liệu (upload hoặc gõ tay), xem đoạn đã cắt, gán nguồn cho từng agent để `kb_search` tra |
| Lịch hẹn | Danh sách lịch, chạy thử ngay, lịch sử từng lần chạy |
| Tools | Bật/tắt 14 công cụ theo account, cấu hình vẽ ảnh và model vision. Chọn một account bot thì công cụ nền tảng không hỗ trợ hiện rõ lý do |
| Cấu hình | **60 tham số** vận hành chỉnh nóng, không cần khởi động lại, chia 11 nhóm |
| Trace | Xem lại từng bước của một lượt agent: model nghĩ gì, gọi tool nào, tham số ra sao |
| Logs | Nhật ký hệ thống |

11 nhóm cấu hình: Nhà cung cấp LLM, Chung, Lượt trả lời (9), Ngữ cảnh & Trí nhớ (6), Tra cứu web
(2), Tạo file Word/Excel (5), Vẽ ảnh (4), Gửi tin trên Zalo (11), Trace và dọn dẹp (4), Lịch hẹn
(9), Kho tri thức (9).

Thứ tự ưu tiên cấu hình ở mọi nơi: **dashboard (DB) > `.env` > mặc định trong schema**. Thiếu cấu
hình LLM không chặn boot - phải vào được dashboard mới nhập được.

## Vì sao đáng tin

Đây là phần khó thấy từ ảnh chụp màn hình, nhưng là phần chiếm nhiều công nhất.

**Chịu được lỗi thật của môi trường thật**

- Mọi lời gọi LLM đi qua **streaming**. Router nằm sau Cloudflare, mà Cloudflare cắt bằng 524 nếu
  origin chưa trả byte đầu trong 100 giây. Đo trên router thật với prompt sinh 4000 chữ:
  non-stream chết ở giây 125, streaming xong ở giây 135 với byte đầu ở giây 7,5
- **Gộp tin theo thread**: người ta nhắn ngắt quãng ba tin thì agent trả lời một lần, không đẻ ra
  ba lượt làm lại từ đầu
- **Chèn tin giữa lượt**: nhắn thêm trong lúc agent đang chạy thì tin đó được kéo vào ngay ở ranh
  giới bước, không phải đợi lượt sau
- Câu trả lời bị Zalo từ chối vì định dạng thì **gửi lại dạng chữ trơn** - mất định dạng chứ
  không mất nội dung
- Chống lặp vòng tool ba tầng, trần thời gian mỗi lượt, trần token đầu ra
- Phân loại lỗi nhà cung cấp thay vì thử lại mù: hết quota tôn trọng `Retry-After` thật, tràn ngữ
  cảnh cắt sâu hơn rồi thử lại, sai khóa thì KHÔNG thử lại và báo câu riêng

**Phòng prompt injection nghiêm túc** (agent đọc tin của người lạ)

- Nội dung web bọc trong thẻ `<noi_dung_ngoai>` có **nonce ngẫu nhiên sinh mỗi lần gọi**, persona
  dạy rõ đó là dữ liệu chứ không phải lệnh. Kẻ tấn công soạn nội dung trước khi biết nonce nên
  không thể viết ra thẻ đóng giả
- `web_fetch` và `send_file` chặn loopback, mạng nội bộ, endpoint metadata của cloud
- **Không có tool chuyển tiền hay thanh toán** - cố ý không làm, dù thư viện có sẵn
- Tool tạo file chỉ nhận **dữ liệu** (tiêu đề, đoạn văn, bảng), tuyệt đối không chạy code model sinh ra
- Câu trả lời rò system prompt bị chặn hẳn trước khi ra Zalo
- Mọi biểu thức chính quy chạm nội dung ngoài đều tuyến tính (chống ReDoS)

**Bảo mật tại chỗ**

- Cookie Zalo và Bot Token mã hóa **AES-256-GCM**, khóa nằm ngoài DB
- Bot Token nằm trong ĐƯỜNG DẪN của Zalo Bot API (`/bot{token}/{method}`), nên client che token
  trong mọi chuỗi sắp vào thông điệp lỗi - ba lớp che, vì đã dựng lại được đường token đi từ trang
  lỗi của cổng trung gian vào dashboard và vào file log
- Mật khẩu dashboard băm bằng scrypt, có rate-limit đăng nhập
- Toàn bộ dữ liệu nằm trên máy bạn: SQLite trong `data/`, không gửi đi đâu ngoài nhà cung cấp LLM bạn chọn

## Cài đặt

```bash
corepack enable
pnpm install
copy .env.example .env
```

`.env` chỉ có **2 dòng phải điền**:

| Biến | Lấy ở đâu |
|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DASHBOARD_PASSWORD` | tự đặt, tối thiểu 8 ký tự |

Mọi thứ còn lại nhập trên dashboard: nhà cung cấp LLM + model + API key (**Cấu hình > Nhà cung cấp
LLM**, làm trước tiên), rồi tài khoản Zalo (trang **Accounts** - quét QR cho tài khoản cá nhân,
hoặc dán Bot Token cho tài khoản bot). Không cần file `config/accounts.json` - DB là nguồn sự thật.

## Chạy

```bash
pnpm dev                    # agent (watch mode) + dashboard
pnpm build:web              # build UI -> web/dist, tiến trình tự serve tại http://127.0.0.1:3900
pnpm dev:web                # dev UI dashboard (Vite, proxy vào API)
pnpm zalo-login acc-chinh   # login QR bằng CLI (cách cũ - trên web tiện hơn; chỉ dùng cho tài khoản CÁ NHÂN)
pnpm zalo-bot-check         # dò Zalo Bot API bằng token thật, in ra method nào sống method nào 404
pnpm test                   # 2136 test
pnpm typecheck              # bắt buộc chạy trước khi báo hoàn thành
pnpm eval                   # 17 case chạy MODEL THẬT, không tin nào ra Zalo thật
```

## Nhà cung cấp LLM

Cắm rời qua `LLM_PROVIDER`, đổi được lúc chạy từ dashboard:

- `openai-compatible` - bất kỳ endpoint nào theo chuẩn OpenAI (router proxy, OpenRouter, LM Studio, Ollama...)
- `anthropic` - gọi thẳng API gốc của Anthropic
- `google` - gọi thẳng API gốc của Google (Gemini). Phải đi đường này chứ không
  qua lớp giả OpenAI của họ: lớp giả làm rơi `thought_signature` nên mọi lượt
  có gọi công cụ sẽ lỗi

Vẽ ảnh và model vision phụ cấu hình riêng, cũng theo chuẩn OpenAI-compatible.

## An toàn - đọc trước khi chạy

> [!WARNING]
> `zca-js` là API **không chính thức**. Zalo có thể khóa tài khoản.
> **Chỉ dùng nick phụ.** Đừng dùng tài khoản chính hay tài khoản có giá trị.
> Rủi ro này **không áp cho tài khoản Zalo Bot chính thức** - đó là API công khai của Zalo.

- `data/` chứa cookie Zalo và Bot Token (đã mã hóa) cùng toàn bộ lịch sử - **không commit, không chia sẻ**
- Mỗi tài khoản cá nhân chỉ được một listener: mở Zalo Web trên trình duyệt sẽ đá listener của
  agent (agent tự kết nối lại và đá ngược lại)
- Tài khoản bot mặc định **đóng allowlist**, khác tài khoản cá nhân - bán kính khác hẳn: nick cá
  nhân phải là bạn bè mới nhắn được, còn bot thì ai có link cũng nhắn được, mở sẵn là mời người lạ
  đốt token và thử prompt injection
- Dự án **cố ý không làm** gửi tin hàng loạt hay campaign CRM
- Deploy sau Caddy/Nginx thì đặt `DASHBOARD_BEHIND_PROXY=true` (rate-limit đúng IP + cookie `Secure`)

## Kiểm thử

| | |
|---|---|
| Test đơn vị + tích hợp | **2136**, chạy bằng `node:test`, không framework ngoài, 202 file test |
| Case eval chạy model THẬT | **17** - đo thứ test không đo nổi: có tra cứu thay vì đoán không, có hỏi lại khi thiếu thông tin không, trình bày có dễ đọc không |
| Nguồn | ~41.900 dòng (không tính test), 355 file |

Eval nhìn thấy được **cả định dạng thật sự gửi lên Zalo**, không chỉ chữ trần - nên lỗi trình bày
bị máy bắt chứ không đợi người dùng phát hiện.

Kỷ luật khi sửa: **phá code rồi chạy lại test để chắc nó ĐỎ**, trước khi báo một bản sửa là xong.
Test xanh không chứng minh gì nếu nó cũng xanh khi logic sai. Và khi thay một biểu thức bảo mật đã
có: chạy **cả hai bản** trên **cùng một tập payload**, khẳng định tập bắt của bản mới là siêu tập
của bản cũ - phép phá chỉ chứng minh code mới CẦN cho test mới, không bao giờ chứng minh nó BAO
TRÙM code cũ.

## Cấu trúc

```
src/
├── config/        env (Zod), account store, agent store, 60 tham số chỉnh nóng
├── zalo/          [kênh CÁ NHÂN] login QR, credential mã hóa, listener + reconnect, parse tin,
│                  lớp làm sạch + dịch markdown sang định dạng Zalo, cắt tin theo byte,
│                  trừu tượng hóa năng lực kênh (KenhLuot)
├── zalo-bot/      [kênh BOT] client Zalo Bot API, long polling, parser update, bảng năng lực
│                  + chặn tool, router riêng, runner theo account
├── agent/         agent loop (AI SDK), provider, persona, tools/ (14 công cụ)
├── scheduler/     lịch hẹn: tick, giành job, trần tin chủ động, lịch sử chạy
├── conversation/  SQLite: history, threads, contacts, usage, memory, ảnh, summarizer
├── middleware/    allowlist + @mention, gộp tin theo thread, rate limit gửi
├── documents/     dựng .docx / .xlsx
├── knowledge/     Kho tri thức - đọc docx/xlsx/pdf/txt/md an toàn (SAX + trần
│                  chống zip bomb), cắt đoạn, FTS5+RRF, worker thread trích xuất
├── images/        vẽ ảnh, model vision phụ
└── server/        dashboard API (Hono)
web/               dashboard UI (React + Vite + Tailwind)
evals/             bộ eval chạy model thật
docs/              kiến trúc, roadmap, hướng dẫn phát hành
```

## Tài liệu

- [Kiến trúc hệ thống](docs/system-architecture.md) - thiết kế và lý do từng quyết định kỹ thuật,
  gồm cả bảng đo thật của Zalo Bot API (hình dạng lỗi, giới hạn, method nào tồn tại)
- [Triển khai lên máy chủ](docs/deployment-guide.md) - Docker, reverse proxy, backup, gỡ rối
- [Dựng máy chủ lần đầu](docs/vps-setup-checklist.md) - user, tường lửa, cron, backup
- [Roadmap](docs/project-roadmap.md) - toàn bộ lịch sử: lỗi đã gặp, cách đo, quyết định đã chốt và
  những giới hạn còn lại. Đây là tài liệu dày nhất và trung thực nhất của dự án
- [CHANGELOG](CHANGELOG.md)
- [Hướng dẫn phát hành](docs/release-guide.md)

## Cập nhật

```bash
git pull
pnpm install
pnpm build:web    # thiếu bước này dashboard vẫn là bản cũ
```

Dữ liệu trong `data/` giữ nguyên, migration chạy tự động lúc khởi động.

## Đóng góp

Mở issue hoặc pull request. Trước khi gửi PR: `pnpm typecheck` và `pnpm test` phải xanh.

## License

[MIT](LICENSE)

Xây trên [zca-js](https://github.com/RFS-ADRENO/zca-js) (MIT) và
[Vercel AI SDK](https://github.com/vercel/ai) (Apache-2.0).
