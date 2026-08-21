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
 * logger, không `process.env`).
 *
 * CẢ HAI ĐIỀU TRÊN LÀ QUY ƯỚC MIỆNG - KHÔNG CÓ GÌ CANH. Bản đầu của khối này
 * viết rằng `tsc --noEmit -p web` sẽ bắt được (b) vì program web không nạp
 * `@types/node`. SAI, và đã đo hai lần: thêm `import "node:fs"` vào
 * `nang-luc-kenh-bot.ts`, rồi thêm `process.env` vào chính file này - typecheck
 * XANH cả hai lần. Lý do: `web/tsconfig.json` include cả cây `src` theo mẫu
 * đệ quy nên nuốt
 * luôn các file `.test.ts` của web, mà chúng `import "node:test"` - thế là
 * `@types/node` vào program qua đường import tường minh; `types:
 * ["vite/client"]` chỉ chặn NẠP TỰ ĐỘNG, không chặn đường đó.
 *
 * Hệ quả rộng hơn (CÓ TỪ TRƯỚC đợt này, từ lúc có file test web đầu tiên): mọi
 * file dashboard đều dùng được `process` / `Buffer` / `__dirname` mà typecheck
 * vẫn xanh, rồi nổ `ReferenceError` trong trình duyệt. Cách đóng đã có công
 * thức - tách test ra khỏi program app bằng `exclude` + một
 * `web/tsconfig.test.json` riêng - nhưng đó là việc của cả dashboard, không
 * phải của đợt lịch hẹn này. Xem mục còn treo ở roadmap V3.19.
 */

export const MO_TA_KENH_BOT =
  "Không gửi được file, tài liệu Word/Excel, ảnh tự vẽ, thả cảm xúc, tag thành viên, " +
  "và không đọc được danh sách thành viên nhóm - đó là giới hạn của Zalo Bot API. " +
  "Đổi lại không có rủi ro bị khóa tài khoản.";

export const MO_TA_KENH_CA_NHAN =
  "Dùng nick Zalo thật qua giao thức không chính thức - đủ tính năng nhất nhưng CÓ rủi ro " +
  "bị Zalo khóa. Chỉ dùng nick phụ.";
