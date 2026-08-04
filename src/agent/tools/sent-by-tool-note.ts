/**
 * Dòng ghi vào history cho những tin do TOOL gửi thẳng xuống Zalo.
 *
 * Vì sao phải có: 5 tool (`send_file`, `create_word_document`,
 * `create_excel_file`, `create_image`, `tag_member`) gọi thẳng `enqueueSend`,
 * không đi qua `deliverChatReply` - mà `deliverChatReply` mới là chỗ duy nhất
 * gọi `appendMessage`. Hệ quả đo được trên bản chạy thật: bot gửi 3 tin trên
 * Zalo (câu dẫn, file .docx, câu chốt) mà dashboard chỉ hiện 1.
 *
 * Nhưng hỏng nặng hơn nằm ở chỗ khác: history CHÍNH LÀ thứ model đọc lại ở lượt
 * sau. Gửi file xong mà không ghi thì bot không nhớ mình đã gửi, và người dùng
 * hỏi lại là nó dựng lại từ đầu - đúng hành vi đã thấy ở lượt 100 và 101 ngày
 * 2026-08-04.
 *
 * Bám nếp `describeForHistory` của tin đến (`<chữ> [ghi chú]`) để hai chiều
 * gửi-nhận đọc ra cùng một kiểu.
 */

/** Gộp caption (nếu có) với ghi chú trong ngoặc vuông */
function ghep(caption: string | undefined, ghiChu: string): string {
  const chu = (caption ?? "").trim();
  return chu ? `${chu} ${ghiChu}` : ghiChu;
}

/** Tin gửi kèm file - dùng cho `send_file` và 2 tool tạo tài liệu */
export function ghiChuDaGuiFile(fileName: string, caption?: string): string {
  return ghep(caption, `[đã gửi file: ${fileName}]`);
}

/** Tin gửi kèm ảnh do bot vẽ */
export function ghiChuDaGuiAnh(soAnh: number, caption?: string): string {
  return ghep(caption, soAnh > 1 ? `[đã gửi ${soAnh} ảnh]` : "[đã gửi ảnh]");
}

/**
 * Tin nhắn thuần chữ do tool gửi (vd `tag_member`, câu "đang vẽ ảnh...").
 *
 * Không thêm ngoặc vuông: đây là chữ THẬT người nhận đọc được, ghi nguyên văn
 * đúng như `deliverChatReply` ghi câu chốt của agent.
 */
export function ghiChuDaGuiChu(noiDung: string): string {
  return noiDung.trim();
}
