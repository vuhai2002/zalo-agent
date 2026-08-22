/**
 * Tool nào CHẠY ĐƯỢC trên kênh Zalo Bot, và tool nào không - kèm lý do.
 *
 * Vì sao phải có bảng này thay vì cứ để tool chạy rồi hỏng: người nhắn sẽ tưởng
 * agent bị lỗi, trong khi đó là GIỚI HẠN CỦA NỀN TẢNG. Tool bị chặn ở đây thì
 * không vào schema gửi cho model, nên model không hứa được việc nó không làm
 * nổi (`toolCapabilitySection` dựng danh sách năng lực từ đúng bộ tool đã lọc).
 *
 * Mọi dòng "không hỗ trợ" dưới đây là ĐO TRÊN API THẬT ngày 2026-08-11, không
 * phải suy từ tài liệu: dò 17 method, 13 cái trả
 * `{"ok":false,"description":"Not Found","error_code":404}` kèm HTTP 200.
 */

/** Lý do một tool không dùng được - hiện cho người vận hành trên dashboard */
export type LyDoKhongHoTro = {
  /** Câu ngắn cho trang Tools */
  hint: string;
};

/**
 * Tool KHÔNG chạy được trên kênh bot. Tool không có tên ở đây thì chạy bình thường.
 *
 * Giữ dạng "danh sách CHẶN" chứ không phải "danh sách CHO PHÉP": tool thuần
 * (không đụng kênh) là đa số và sẽ tiếp tục là đa số, nên danh sách chặn ngắn
 * hơn và ít phải sửa hơn mỗi lần thêm tool mới.
 */
export const TOOL_KHONG_CHAY_TREN_BOT: Record<string, LyDoKhongHoTro> = {
  send_file: {
    hint: "Zalo Bot API không có method gửi file (đo thật: sendDocument/sendFile đều trả 404)",
  },
  create_word_document: {
    hint: "Tạo được file nhưng không gửi được - Zalo Bot API không có method gửi tài liệu",
  },
  create_excel_file: {
    hint: "Tạo được file nhưng không gửi được - Zalo Bot API không có method gửi tài liệu",
  },
  create_image: {
    // sendPhoto CÓ tồn tại, nhưng chỉ nhận URL công khai: multipart trả "The
    // photo must not be empty", data URI và base64 đều trả "The photo must
    // start with http:// or https://". Ảnh bot tự vẽ nằm trên đĩa nên không
    // gửi thẳng được. Mở lại được nếu sau này có đường phục vụ ảnh qua HTTPS.
    hint: "Zalo Bot API chỉ gửi ảnh qua URL công khai, không nhận file tải lên - cần đường phục vụ ảnh qua HTTPS trước",
  },
  tai_video: {
    // Grep toàn bộ `src/zalo-bot/` không ra method nào gửi video, và tool này
    // dựng trên `api.sendVideo` của zca-js - thứ `KenhLuot.api` để null trên
    // kênh bot.
    hint: "Zalo Bot API không có method gửi video",
  },
  add_reaction: {
    hint: "Zalo Bot API không có method thả cảm xúc (setMessageReaction trả 404)",
  },
  tag_member: {
    hint: "Zalo Bot API không có method tag thành viên trong nhóm",
  },
  // `schedule_task` TỪNG nằm đây, và nó là mục DUY NHẤT trong bảng không dẫn
  // được một số đo 404 hay ràng buộc cứng nào - lý do thật là scheduler khóa
  // cứng vào zca-js (`getRunningAccountApi` + `duongGuiZcaJs` dựng tay), nên
  // tài khoản bot không bao giờ có đường gửi. Bot API gửi chủ động được: đo
  // thật 10 tin trong 416ms, không bị chặn. Đã nối ở
  // `scheduled-job-reply-target.ts` - xem V3.19 trong roadmap.
  get_group_info: {
    hint: "Zalo Bot API không có method đọc thông tin nhóm (getChat/getChatMember trả 404)",
  },
};

export function toolChayDuocTrenBot(key: string): boolean {
  return !(key in TOOL_KHONG_CHAY_TREN_BOT);
}

/**
 * Dòng ghép vào persona khi lượt chạy trên kênh bot.
 *
 * Chỉ ẩn tool là CHƯA ĐỦ: model sẽ trả lời "tôi không làm được việc đó" mà
 * không nói vì sao, và người nhắn tưởng agent hỏng. Dòng này để model nói đúng
 * nguyên nhân và chỉ đường sang kênh dùng được.
 */
export const LUAT_PERSONA_KENH_BOT =
  "- Bạn đang chạy trên TÀI KHOẢN BOT của Zalo. Kênh này KHÔNG gửi được file, " +
  "tài liệu Word/Excel, ảnh tự vẽ, video tải về, không thả được cảm xúc, không tag được ai " +
  "trong nhóm và không xem được danh sách thành viên nhóm - đó là giới hạn của " +
  "nền tảng Zalo, KHÔNG phải bạn bị lỗi. Ai nhờ mấy việc đó thì nói thẳng là tài " +
  "khoản bot không làm được, và mời họ nhắn qua tài khoản cá nhân nếu cần. Đừng " +
  "hứa rồi im, cũng đừng xin lỗi vòng vo.";
