/**
 * Câu mô tả hai loại kênh, hiện ngay dưới ô chọn "Loại kênh" lúc TẠO account.
 *
 * Tách khỏi JSX để test đọc được. Không phải cầu kỳ: `loai` chốt lúc tạo và
 * không đổi được sau đó, nên câu này là thứ người vận hành dựa vào để ra một
 * quyết định KHÔNG ĐẢO NGƯỢC ĐƯỢC (sửa lại đòi xóa account, mà xóa account thì
 * dọn luôn toàn bộ lịch hẹn của nó).
 *
 * Đã trả giá một lần: câu cho kênh bot từng ghi "không đặt lịch hẹn" và nằm lại
 * sau khi lịch hẹn đã nối xong ở V3.19 - tức nó đẩy người cần lịch hẹn sang
 * kênh cá nhân, kênh CÓ rủi ro bị Zalo khóa nick. Luật persona của kênh bot có
 * test canh đúng chuyện này (`lich-hen-tren-kenh-bot.test.ts`), còn chuỗi
 * dashboard thì không - nên nó là chỗ duy nhất trôi lại. Giờ có canh.
 *
 * RÀNG BUỘC KÈM THEO: ca test của file này import `TOOL_KHONG_CHAY_TREN_BOT`
 * từ `src/zalo-bot/nang-luc-kenh-bot.ts` để hai bên không trôi khỏi nhau. Đó là
 * import DUY NHẤT xuyên ranh giới `web/` -> `src/` trong cả repo, và nó chỉ hợp
 * lệ chừng nào hai điều còn đúng: (a) chỉ file `.test.ts` được import như vậy -
 * mã app import là kéo mã server vào bundle trình duyệt; (b)
 * `nang-luc-kenh-bot.ts` phải giữ THUẦN (không `node:*`, không DB, không
 * logger, không `process.env`). Lý do (b) không hiển nhiên: `tsc --noEmit -p web`
 * giờ kéo file đó vào một program có `lib: DOM` và KHÔNG tự nạp `@types/node`,
 * nên thêm một dòng bình thường phía server vào đó sẽ làm `pnpm typecheck` gãy ở
 * PROJECT WEB với thông điệp không liên quan gì tới thứ vừa sửa.
 */

export const MO_TA_KENH_BOT =
  "Không gửi được file, tài liệu Word/Excel, ảnh tự vẽ, thả cảm xúc, tag thành viên, " +
  "và không đọc được danh sách thành viên nhóm - đó là giới hạn của Zalo Bot API. " +
  "Đổi lại không có rủi ro bị khóa tài khoản.";

export const MO_TA_KENH_CA_NHAN =
  "Dùng nick Zalo thật qua giao thức không chính thức - đủ tính năng nhất nhưng CÓ rủi ro " +
  "bị Zalo khóa. Chỉ dùng nick phụ.";
