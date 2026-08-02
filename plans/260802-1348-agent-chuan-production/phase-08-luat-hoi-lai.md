# Phase 08 - Luật hỏi lại (khoảng cách F)

## Liên kết ngữ cảnh

- [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html) mục 8/F
  (**lưu ý**: mục đó mô tả F là approval gate - đã bị bác bỏ, xem mục Nhận định dưới đây)
- Mẫu tham chiếu: `zalo-agent-references/hermes-agent/tools/clarify_tool.py`
- Code: `src/agent/persona-prompt.ts` (`BASE_PERSONA`, khối "Quy tắc trả lời")

## Tổng quan

- **Ưu tiên**: thấp về công sức, cao về giá trị cảm nhận
- **Trạng thái**: XONG. 9/9 case eval đạt (3 case mới + 6 case cũ không hồi quy).
- Ba dòng vào `BASE_PERSONA` + case eval canh. Không thêm tool, không thêm bảng, không đụng
  agent loop.

## Nhận định then chốt

- **F ban đầu bị đặt sai bài toán.** Bản audit đầu mô tả F là "duyệt trước khi chạy tool"
  (approval gate). Người dùng bác bỏ, và đúng: **12-Factor #7 tên là "Contact Humans with
  Tool Calls"** - nói về agent **chủ động hỏi khi thiếu thông tin**, không phải xin phép
  trước khi làm việc đã rõ. Xác nhận thêm bằng `clarify_tool.py` của Hermes: câu hỏi có
  cấu trúc, tối đa 4 lựa chọn, chat platform render thành danh sách đánh số.
- **Approval gate với zalo-agent gần như vô giá trị.** Năm tool tác động ra ngoài **đã**
  bị loại khỏi lượt theo lịch (`runsInScheduledTurn: false`), nội dung web đã bị bọc
  `<noi_dung_ngoai>`, người đang chat thường là chủ bot. Hỏi "gửi file nhé?" sau một lệnh
  rõ ràng chỉ là ma sát.
- **Trong chat bot, model đã có thể hỏi lại miễn phí** - trả lời bằng một câu hỏi, lượt kết
  thúc, người dùng nhắn tiếp. Không cần trạng thái chờ, không cần bảng pending.
- **Persona hiện không có dòng nào về việc hỏi lại.** Đã tra `persona-prompt.ts` và
  `persona-tool-rules.ts`: không có.
- **Luật quá rộng làm bot hỏi vặn.** *"Thiếu thông tin thì hỏi lại"* không nói khi nào
  **không** hỏi. Hỏi đáp kiến thức thường mà bot cũng hỏi vặn thì tệ hơn là cứ trả lời.
  Anthropic gọi đây là chọn sai "độ cao" của prompt.
- **Chỗ đúng là `BASE_PERSONA`, không phải ô persona của agent.** Đây là luật hành xử chung,
  mọi agent phải có, phải nằm trong git và test được. Ô persona của agent để dành cho thứ
  thật sự riêng.

## Yêu cầu

- Ba dòng vào khối "Quy tắc trả lời" của `BASE_PERSONA`, có **cả** mặt phải lẫn mặt trái.
- Case eval khẳng định bot hỏi lại khi thiếu thông tin, và **không** hỏi vặn khi đã đủ.
- Không thêm tool, không thêm bảng, không đổi agent loop.

## Kiến trúc

Chèn vào `BASE_PERSONA`, khối "Quy tắc trả lời":

```
- Việc làm xong mới biết sai thì tốn công làm lại (tạo file, đặt lịch, vẽ ảnh):
  thiếu thông tin thì HỎI LẠI, đừng đoán.
- Trò chuyện thường và hỏi đáp kiến thức thì cứ trả lời thẳng, đừng hỏi vặn.
- Hỏi MỘT lần, gom hết thứ còn thiếu vào một câu. Đừng hỏi lắt nhắt qua nhiều lượt.
```

Ba dòng, ba vai: **khi nào hỏi** / **khi nào không** / **hỏi thế nào**. Bỏ dòng nào cũng
mất một vai.

## File liên quan

Sửa:
- `src/agent/persona-prompt.ts` - `BASE_PERSONA`
- `src/agent/persona-prompt.test.ts` - khẳng định ba dòng có mặt trong system prompt
- `evals/cases/hoi-lai.ts` - **tạo mới**, 3 case

## Các bước

1. Chèn ba dòng vào cuối khối "Quy tắc trả lời" (trước khối "Quy tắc an toàn"). Đặt sau
   các luật về độ dài để không cắt ngang mạch đang nói về cách trình bày.
2. Test model giả: system prompt chứa ba dòng đó. Rẻ, nhưng chỉ chứng minh **có gửi đi**,
   không chứng minh model **nghe theo** - đó là việc của eval.
3. `evals/cases/hoi-lai.ts` - ba case:
   - **Phải hỏi**: *"tạo file Excel giúp tôi"* (không nói nội dung gì) -> **không** được gọi
     `create_excel_file`; câu trả lời phải kết thúc bằng dấu hỏi.
   - **Không được hỏi vặn**: *"thủ đô nước Pháp là gì?"* -> câu trả lời **không** kết thúc
     bằng dấu hỏi (đã đủ thông tin, cứ trả lời).
   - **Hỏi gộp một lần**: *"đặt lịch nhắc tôi"* (thiếu cả giờ lẫn nội dung) -> không gọi
     `schedule_task`; câu trả lời chỉ có **một** lượt hỏi, không phải chuỗi câu hỏi rời.
4. Chạy `pnpm eval`. Case nào đỏ thì chỉnh **câu chữ** ba dòng, không chỉnh case - case mô
   tả hành vi mong muốn, persona là thứ phải chiều theo nó.
5. Ghi lại vào `CLAUDE.md` mục "Quyết định đã chốt": F là luật hỏi lại, **không** phải
   approval gate, kèm lý do - để lần sau không ai mở lại.

## Việc cần làm

- [x] Ba dòng vào `BASE_PERSONA`, đặt đúng chỗ trong khối "Quy tắc trả lời"
- [x] Test model giả: ba dòng có trong system prompt
- [x] `evals/cases/hoi-lai.ts` - 3 case (phải hỏi / không hỏi vặn / hỏi gộp)
- [x] `pnpm eval` xanh cả 3
- [x] Ghi quyết định vào `CLAUDE.md`
- [x] `pnpm test` + `pnpm typecheck`

## Tiêu chí hoàn thành

- Nhắn *"tạo file Excel giúp tôi"* trên Zalo thật: bot hỏi lại nội dung, **không** tạo file
  rỗng.
- Nhắn một câu hỏi kiến thức bình thường: bot trả lời thẳng, không hỏi vặn.
- Ba case eval xanh.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Bot hỏi vặn cả những câu đã rõ | Dòng thứ hai nói rõ khi nào **không** hỏi; case eval thứ hai canh đúng chuyện này |
| Ba dòng làm phình prompt gửi mỗi step | Khoảng 60 token, đổi lại tránh được cả lượt làm lại - lãi rõ |
| Model mạnh yếu khác nhau nghe theo khác nhau | Eval chạy với model đang cấu hình thật, nên đo đúng model đang dùng |
| Sửa persona làm hỏng hành vi khác | Chạy **toàn bộ** `pnpm eval`, không chỉ 3 case mới |

## An ninh

- Không mở thêm quyền nào. Ba dòng chỉ đổi cách bot phản ứng khi thiếu dữ liệu.
- **Không** thêm tool mới, nên không tăng diện tích tấn công qua schema tool.

## Bước kế tiếp

Nếu sau này thấy cần lựa chọn đánh số (1/2/3 cho người bấm nhanh), lúc đó mới cân nhắc tool
`ask_user` kiểu `clarify_tool.py`. Chưa có bằng chứng cần thì đừng thêm.

## Kết quả đo được - đọc trước khi tin vào ba dòng này

**Ba dòng persona KHÔNG chứng minh được tác dụng với model đang dùng.** Bỏ hẳn cả ba
rồi chạy lại `pnpm eval`, cả ba case hỏi-lại VẪN XANH - kể cả ca khó hơn ("đặt lịch
nhắc mình uống thuốc buổi sáng": có nội dung nhưng giờ mơ hồ, đúng ca dễ dụ model đoán
bừa nhất). gpt-combo tự biết hỏi lại mà không cần dặn.

Vẫn giữ ba dòng, và nói rõ vì sao: khoảng 60 token trên một prefix vốn đã được
prompt-cache nên gần như không tốn gì, và nó ghi lại ý định cho lần đổi sang model rẻ
hơn. KHÔNG phải vì đã đo thấy nó có tác dụng.

Ba case eval giữ lại với vai HÀNG RÀO HỒI QUY, không phải bằng chứng: chúng canh hành
vi của CẢ HỆ THỐNG. Đổi model rẻ hơn, hay ai đó sửa persona theo hướng giục model làm
cho nhanh, thì đây là chỗ đỏ trước khi người dùng nhận một file Excel rỗng.

## Lệch so với kế hoạch (có chủ ý)

- Case nằm trong `evals/eval-cases.ts` chứ không phải file riêng `evals/cases/hoi-lai.ts`
  (bộ case đã gộp một file từ phase 07).
- **Không** đòi câu trả lời phải có dấu hỏi, dù bản kế hoạch ghi vậy. Lần chạy thật cho
  ra: "Bạn gửi mình toàn bộ thông tin trong một lần để mình làm đúng ngay:" rồi liệt kê
  gạch đầu dòng - gom đúng ý, không tạo file bừa, chỉ là viết ở thể mệnh lệnh nên không
  có dấu hỏi nào.

  Kế hoạch dặn "case đỏ thì sửa persona, đừng sửa case". Luật đó đúng khi case mã hóa
  đúng hành vi mong muốn - ở đây nó mã hóa một SỞ THÍCH DIỄN ĐẠT, mà chính bộ eval cấm
  khẳng định trên câu chữ. Sửa persona để bot luôn kết thúc bằng dấu hỏi là làm câu trả
  lời tệ đi để chiều một phép đo sai. Bất biến thật nằm ở `khongGoiTool`: thiếu thông
  tin thì KHÔNG làm bừa.
