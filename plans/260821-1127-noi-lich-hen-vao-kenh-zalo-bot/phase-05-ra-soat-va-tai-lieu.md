# Phase 05 - Rà soát toàn cục, test dưới tải, cập nhật tài liệu

Ưu tiên: cao (không có nó thì bốn phase trên chỉ là "chạy được trên máy tôi").
Phụ thuộc: 01-04. Trạng thái: [ ] chưa làm.

## 1. Rà soát toàn cục

Rà từng phase KHÔNG đủ - lỗi tương tác chéo không lộ ra khi soi từng commit.
Đợt này bắc cầu 4 module (`account-manager`, `zalo-bot`, `scheduler`,
`send-reply-in-parts`) nên đúng loại việc mà lỗi nằm ở KHỚP NỐI.

Danh sách phải tự đi lại một lượt trên cả dải thay đổi:

- [ ] Grep `duongGuiZcaJs` - còn chỗ nào dựng `ReplyTarget` bằng tay không?
- [ ] Grep `getRunningAccountApi` - còn caller nào giả định nó luôn có giá trị?
- [ ] Grep `loai === "bot"` - còn nhánh nào chặn nhầm?
- [ ] `taoReplyTargetChoJob` có bao giờ ném không? (bị gọi không-await từ tick)
- [ ] `run-scheduled-job.ts` còn bao nhiêu dòng? (hiện ~298, luật là 200)
- [ ] Mọi hàm trong `proactive-send-guard.ts` vẫn KHÔNG có `= new Date()`?
- [ ] `attachAccount` vẫn ném cho `loai === "bot"` (lá chắn cuối)?
- [ ] Kênh bot chạm trần ngày -> câu báo trần có tới nơi không? (lỗ câm mục 4)

## 2. Test dưới tải

Máy rảnh cho xanh giả. Nghiệm thu ở **>= 12 tiến trình đốt CPU**, chạy full
suite ít nhất 3 lượt.

Đợt này đẻ ra hai nguồn nhấp nháy tiềm năng, phải soi riêng:

- `lich-hen-kenh-bot.test.ts` dùng `startAccount` (hai vòng mạng giả) rồi mới
  chạy job. Bất kỳ chỗ nào `await sleep(N)` rồi khẳng định số đếm là sai khuôn
  - dùng `doiChoDenKhi`/`doiChoSoLuong` (`src/shared/doi-cho-den-khi.ts`).
- `SCHEDULER_SEND_GAP_MS` phải đặt `0` trong `setupTestEnv` (mặc định 20000ms
  rải đều toàn cục) - không thì ca 6 (trần ngày) treo cả runner.

Khẳng định PHỦ ĐỊNH ("account tắt thì KHÔNG được gửi") thì GIỮ `sleep` - chờ-
đến-khi ở đó về ngay lần thử đầu nên chẳng chứng minh gì.

## 3. Tài liệu

| File | Sửa gì |
|---|---|
| `README.md:52` | Bảng hai kênh: "Lịch hẹn \| có \| chưa nối" -> "có \| có" |
| `README.md:100` | Bảng tool: `schedule_task` cột "Kênh Bot" -> "có" |
| `README.md:71` | "Vì sao 8 công cụ không chạy" -> 7 |
| `README.md:105-107` | "8 trong 14" -> "7 trong 14"; "9 công cụ bị loại khỏi lượt theo lịch" giữ nguyên (không đổi) |
| `README.en.md:104` + các chỗ tương ứng | Cùng bộ sửa |
| `docs/system-architecture.md:314` | Mục "8 trong 14 tool không chạy được" -> 7, bỏ `schedule_task` khỏi danh sách |
| `docs/system-architecture.md:3` | Sơ đồ tổng quan: "tools: 14 cái; kênh bot chặn 8" -> 7. **Nhân tiện sửa nợ cũ**: sơ đồ vẫn ghi `generateText` trong khi đã chốt mọi lời gọi LLM đi qua `chayStream()` |
| `docs/project-roadmap.md` | Thêm mục **V3.19**; đóng 2 mục treo của kênh bot ("Nhắn chủ động / lịch hẹn", "`PATCH /api/schedule/:id` không kiểm `loai`") |
| `CHANGELOG.md` | Mục mới |
| `CLAUDE.md` | Cập nhật dòng quyết định về `schedule_task` bị chặn trên kênh bot (nếu có); thêm quyết định `mangDinhDang` |

Nguyên tắc viết roadmap của repo này: ghi cả **cách đo** và **cái sai đã tin
trước đó**, không chỉ ghi kết quả. Mục V3.19 phải có:

- Vì sao đây không phải giới hạn nền tảng (số đo 416ms, so sánh 8 dòng bảng chặn).
- Đính chính của chính đợt này: bản báo cáo đầu nói "cơ chế thử lại của
  scheduler dựa vào `laLoiMayChuTuChoi`" - SAI, grep ra nó chỉ có 2 caller và
  `concludeDeliveryFailed` không hề gọi.
- Chỗ khóa cứng THỨ HAI (`scheduled-job-cap-guard.ts`) mà vòng rà đầu bỏ sót,
  và vì sao nó hỏng câm.
- Vì sao thứ tự phase là ràng buộc cứng chứ không phải sở thích.

## 4. Việc còn treo sau đợt này (ghi vào roadmap, không làm)

- `ReplyTarget.threadType` vẫn mang kiểu zca-js - trừu tượng kênh mới xong một nửa.
- `run-scheduled-job.ts` vẫn vượt 200 dòng.
- `laLoiMayChuTuChoi` vẫn không hiểu `LoiZaloBotApi`. Sau phase 03 thì vô hại
  (không còn `styles` để mà bỏ trên kênh bot), nhưng nó là mìn cho ai muốn
  thêm đường lui khác cho kênh bot sau này.
- Kênh bot vẫn không có chữ đậm/nghiêng.
- `pnpm zalo-login <id>` không kiểm `loai`.
- Vòng poll của kênh bot vẫn không có sàn nhịp.

## Tiêu chí xong

- Full suite xanh 3/3 lượt dưới >= 12 burner.
- `pnpm typecheck` sạch (cả `web`).
- 8 mục rà soát ở phần 1 đều có câu trả lời ghi lại, không phải "chắc là ổn".
- Tài liệu khớp code - đặc biệt là con số 7 (không còn chỗ nào ghi 8).
