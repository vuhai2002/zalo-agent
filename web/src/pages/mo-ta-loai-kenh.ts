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
 * CẢ HAI ĐIỀU TRÊN LÀ QUY ƯỚC MIỆNG - KHÔNG CÓ GÌ CANH. Khối này đã viết SAI
 * cơ chế HAI LẦN, mỗi lần đều nghe hợp lý, và cả hai chỉ lộ ra khi có người đo:
 *
 *  - Bản 1: "program web không nạp `@types/node` nên typecheck sẽ bắt". Sai -
 *    thêm `process.env` vào file web thuần vẫn XANH.
 *  - Bản 2: "vì `include` nuốt các file `.test.ts`, mà chúng `import
 *    "node:test"`". Cũng SAI. Phép đo quyết định: bỏ `vite.config.ts` khỏi
 *    `include` mà GIỮ nguyên các file test -> chính CÁC FILE TEST đỏ với
 *    `Cannot find name 'node:test'`. Tức chúng là bên TIÊU THỤ `@types/node`,
 *    không phải nguồn.
 *
 * Nguồn thật: `web/tsconfig.json` include `vite.config.ts`, file đó import
 * `vite`, và `vite/dist/node/index.d.ts` mở đầu bằng một chỉ thị tham chiếu
 * kiểu `node`. Chỉ thị dạng đó KHÔNG bị `types: ["vite/client"]` chặn - trường
 * đó chỉ chặn NẠP TỰ ĐỘNG từ `node_modules/@types`.
 *
 * Hệ quả rộng hơn, CÓ TỪ 2026-07-25 (commit dựng dashboard, không liên quan
 * gì tới file test): mọi file dashboard đều dùng được `process` / `Buffer` /
 * `__dirname` mà typecheck vẫn xanh, rồi nổ `ReferenceError` trong trình
 * duyệt. Công thức đóng đã ĐO ĐƯỢC (không phải đoán): một `tsconfig` riêng
 * cho mã app, KHÔNG chứa `vite.config.ts` và loại các file test - đo trực
 * tiếp thì `process.env` trong file app đỏ đúng `TS2591`, còn cây app sạch
 * thì vẫn sạch. Đó là việc của CẢ dashboard, không phải của đợt lịch hẹn
 * này - xem mục còn treo ở roadmap V3.19.
 */

export const MO_TA_KENH_BOT =
  "Không gửi được file, tài liệu Word/Excel, ảnh tự vẽ, video tải về, thả cảm xúc, tag thành viên, " +
  "và không đọc được danh sách thành viên nhóm - đó là giới hạn của Zalo Bot API. " +
  "Đổi lại không có rủi ro bị khóa tài khoản.";

export const MO_TA_KENH_CA_NHAN =
  "Dùng nick Zalo thật qua giao thức không chính thức - đủ tính năng nhất nhưng CÓ rủi ro " +
  "bị Zalo khóa. Chỉ dùng nick phụ.";
