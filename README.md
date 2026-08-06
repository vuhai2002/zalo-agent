<p align="center"><strong>zalo-agent</strong></p>

<p align="center">
Bot AI thường trú trên Zalo <strong>tài khoản cá nhân</strong>. Nhiều account chạy chung một tiến trình,<br/>
mỗi account một "não" riêng, 13 công cụ, dashboard web đầy đủ. Tự host, không phụ thuộc nhà cung cấp LLM nào.
</p>

<p align="center">
  <a href="#cài-đặt">Cài đặt</a> •
  <a href="#bot-làm-được-gì">Tính năng</a> •
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
  <img src="https://img.shields.io/badge/tests-1556%20xanh-brightgreen?style=flat-square" alt="tests" />
</p>

---

Luồng một lượt: **tin Zalo -> lọc (allowlist, @mention) -> gộp theo thread -> agent loop (LLM tự
gọi tool) -> làm sạch + dịch định dạng -> cắt theo trần byte -> gửi**.

Không có bước nào chạy code do model sinh ra. Nội dung lấy từ web luôn bị bọc trong thẻ đánh dấu
là dữ liệu, không phải mệnh lệnh.

## Bot làm được gì

13 công cụ, bật/tắt từng cái theo account ngay trên dashboard.

| Công cụ | Làm gì |
|---|---|
| `web_search` | Tìm web theo chuỗi nguồn (Brave -> DuckDuckGo). DuckDuckGo không cần key |
| `web_fetch` | Đọc 1 URL công khai. Chặn IP nội bộ và metadata cloud (chống SSRF) |
| `read_image` | Nhìn kỹ lại ảnh với câu hỏi cụ thể: đếm số lượng, đọc chữ nhỏ, soi chi tiết |
| `create_image` | Vẽ ảnh AI mới, hoặc **SỬA ảnh người dùng vừa gửi** - phần còn lại giữ nguyên từng pixel |
| `create_word_document` | Soạn .docx (tiêu đề, đoạn văn, bảng, hai cột) rồi gửi thẳng trong chat |
| `create_excel_file` | Soạn .xlsx nhiều sheet, **có công thức kèm sẵn kết quả** nên xem trước trên điện thoại vẫn thấy số |
| `send_file` | Gửi file từ kho `data/shared-files/` hoặc tải từ URL công khai |
| `schedule_task` | Đặt/xem/sửa/hủy lịch để bot tự nhắn lại đúng cuộc trò chuyện này |
| `save_memory` | Ghi nhớ lâu dài về người dùng, sống qua nhiều phiên chat |
| `get_datetime` | Ngày giờ chính xác theo múi giờ cấu hình |
| `tag_member` | @mention đúng người trong nhóm |
| `get_group_info` | Tên nhóm, số thành viên, danh sách thành viên |
| `add_reaction` | Thả cảm xúc vào tin nhắn |

### Tin nhắn có định dạng thật

Bot không trả về một khối chữ phẳng. Markdown của model được **dịch** thành định dạng gốc của
Zalo (`textProperties`), không phải bị xóa đi:

- **In đậm**, *in nghiêng*, ~~gạch ngang~~, gạch chân, tiêu đề cỡ lớn
- **Bốn màu chữ** (đỏ, cam, vàng, xanh lá) cho thư mời và thông báo trang trọng
- Emoji dẫn dòng chọn theo đúng nghĩa của dòng

Toàn bộ đã **đo trên máy thật, cả Zalo Web lẫn Zalo điện thoại** - hai client render khác nhau
ở vài chỗ, và những chỗ đó đã bị loại khỏi thiết kế. Zalo còn từ chối cả tin khi chữ cộng định
dạng vượt một ngưỡng byte, nên bộ gửi tự co trần ký tự cho vừa ngân sách rồi mới cắt.

### Lịch hẹn (bot tự nhắn)

Ba loại lịch: `once`, `every`, `cron`. Đặt bằng lời ngay trong chat hoặc trên dashboard.

- Loại `message`: gửi nguyên văn, **0 token**
- Loại `agent`: chạy một lượt AI riêng, cô lập khỏi lịch sử chat (tra cứu rồi báo cáo)
- Hai lớp chống spam: chặn lịch lặp quá dày lúc tạo, và trần số tin chủ động mỗi ngày
- Lịch trễ vẫn GỬI kèm nhãn "(nhắc trễ, lịch gốc HH:MM)" thay vì im lặng nuốt

### Trí nhớ

- Lịch sử hội thoại trong SQLite, theo account + thread
- **Rolling summary**: phần rơi khỏi cửa sổ replay được tóm tắt lại chứ không mất
- **Fact bền** qua `save_memory`, có luật riêng tư bất đối xứng giữa chat riêng và nhóm
- Ảnh nhận được lưu lại, mô tả bằng model vision phụ và cache lại để lượt sau khỏi trả tiền lần nữa

## Dashboard

Hono + React + Tailwind, phục vụ ngay từ chính tiến trình bot tại `http://127.0.0.1:3900`.

| Trang | Dùng để |
|---|---|
| Tổng quan | Token vào/ra theo ngày, gộp mọi account |
| Accounts | Thêm tài khoản Zalo, **quét QR login ngay trên web**, bật/tắt từng account |
| Agents | Mỗi account một "não": persona riêng, model riêng, bộ công cụ riêng |
| Sessions | Đọc lại từng cuộc trò chuyện, xem tóm tắt bot tự dựng, bật/tắt bot theo thread, **xóa sạch ngữ cảnh** một cuộc trò chuyện |
| Contacts | Danh bạ đã gặp |
| Memory | Xem, sửa, xóa từng điều bot đã nhớ |
| Lịch hẹn | Danh sách lịch, chạy thử ngay, lịch sử từng lần chạy |
| Tools | Bật/tắt 13 công cụ theo account, cấu hình vẽ ảnh và model vision |
| Cấu hình | **54 tham số** vận hành chỉnh nóng, không cần khởi động lại |
| Trace | Xem lại từng bước của một lượt agent: model nghĩ gì, gọi tool nào, tham số ra sao |
| Logs | Nhật ký hệ thống |

Thứ tự ưu tiên cấu hình ở mọi nơi: **dashboard (DB) > `.env` > mặc định trong schema**. Thiếu cấu
hình LLM không chặn boot - phải vào được dashboard mới nhập được.

## Vì sao đáng tin

Đây là phần khó thấy từ ảnh chụp màn hình, nhưng là phần chiếm nhiều công nhất.

**Chịu được lỗi thật của môi trường thật**

- Mọi lời gọi LLM đi qua **streaming**. Router nằm sau Cloudflare, mà Cloudflare cắt bằng 524 nếu
  origin chưa trả byte đầu trong 100 giây. Đo trên router thật với prompt sinh 4000 chữ:
  non-stream chết ở giây 125, streaming xong ở giây 135 với byte đầu ở giây 7,5
- **Gộp tin theo thread**: người ta nhắn ngắt quãng ba tin thì bot trả lời một lần, không đẻ ra ba
  lượt làm lại từ đầu
- **Chèn tin giữa lượt**: nhắn thêm trong lúc bot đang chạy thì tin đó được kéo vào ngay ở ranh
  giới bước, không phải đợi lượt sau
- Câu trả lời bị Zalo từ chối vì định dạng thì **gửi lại dạng chữ trơn** - mất định dạng chứ
  không mất nội dung
- Chống lặp vòng tool ba tầng, trần thời gian mỗi lượt, trần token đầu ra

**Phòng prompt injection nghiêm túc** (bot đọc tin của người lạ)

- Nội dung web bọc trong thẻ `<noi_dung_ngoai>`, persona dạy rõ đó là dữ liệu chứ không phải lệnh
- `web_fetch` và `send_file` chặn loopback, mạng nội bộ, endpoint metadata của cloud
- **Không có tool chuyển tiền hay thanh toán** - cố ý không làm, dù thư viện có sẵn
- Tool tạo file chỉ nhận **dữ liệu** (tiêu đề, đoạn văn, bảng), tuyệt đối không chạy code model sinh ra
- Câu trả lời rò system prompt bị chặn hẳn trước khi ra Zalo
- Mọi biểu thức chính quy chạm nội dung ngoài đều tuyến tính (chống ReDoS)

**Bảo mật tại chỗ**

- Cookie Zalo mã hóa **AES-256-GCM**, khóa nằm ngoài DB
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
LLM**, làm trước tiên), rồi tài khoản Zalo + quét QR (trang **Accounts**). Không cần file
`config/accounts.json` - DB là nguồn sự thật.

## Chạy

```bash
pnpm dev                    # bot (watch mode) + dashboard
pnpm build:web              # build UI -> web/dist, bot tự serve tại http://127.0.0.1:3900
pnpm dev:web                # dev UI dashboard (Vite, proxy vào API)
pnpm zalo-login acc-chinh   # login QR bằng CLI (cách cũ - trên web tiện hơn)
pnpm test                   # 1556 test
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

- `data/` chứa cookie Zalo (đã mã hóa) và toàn bộ lịch sử - **không commit, không chia sẻ**
- Mỗi account chỉ được một listener: mở Zalo Web trên trình duyệt sẽ đá listener của bot (bot tự
  kết nối lại và đá ngược lại)
- Dự án **cố ý không làm** gửi tin hàng loạt hay campaign CRM
- Deploy sau Caddy/Nginx thì đặt `DASHBOARD_BEHIND_PROXY=true` (rate-limit đúng IP + cookie `Secure`)

## Kiểm thử

| | |
|---|---|
| Test đơn vị + tích hợp | **1556**, chạy bằng `node:test`, không framework ngoài |
| Case eval chạy model THẬT | **17** - đo thứ test không đo nổi: có tra cứu thay vì đoán không, có hỏi lại khi thiếu thông tin không, trình bày có dễ đọc không |
| Nguồn | ~31.700 dòng (không tính test), 273 file |

Eval nhìn thấy được **cả định dạng thật sự gửi lên Zalo**, không chỉ chữ trần - nên lỗi trình bày
bị máy bắt chứ không đợi người dùng phát hiện.

Kỷ luật khi sửa: **phá code rồi chạy lại test để chắc nó ĐỎ**, trước khi báo một bản sửa là xong.
Test xanh không chứng minh gì nếu nó cũng xanh khi logic sai.

## Cấu trúc

```
src/
├── config/        env (Zod), account store, agent store, 54 tham số chỉnh nóng
├── zalo/          login QR, credential mã hóa, listener + reconnect, parse tin,
│                  lớp làm sạch + dịch markdown sang định dạng Zalo, cắt tin theo byte
├── agent/         agent loop (AI SDK), provider, persona, tools/ (13 công cụ)
├── scheduler/     lịch hẹn: tick, giành job, trần tin chủ động, lịch sử chạy
├── conversation/  SQLite: history, threads, contacts, usage, memory, ảnh, summarizer
├── middleware/    allowlist + @mention, gộp tin theo thread, rate limit gửi
├── documents/     dựng .docx / .xlsx
├── images/        vẽ ảnh, model vision phụ
└── server/        dashboard API (Hono)
web/               dashboard UI (React + Vite + Tailwind)
evals/             bộ eval chạy model thật
docs/              kiến trúc, roadmap, hướng dẫn phát hành
```

## Tài liệu

- [Kiến trúc hệ thống](docs/system-architecture.md) - thiết kế và lý do từng quyết định kỹ thuật
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
