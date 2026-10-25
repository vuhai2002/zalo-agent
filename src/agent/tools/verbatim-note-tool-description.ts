/**
 * Mô tả tool `verbatim_note` gửi model - tách khỏi file tool để file đó còn
 * dưới 200 dòng. Cùng nếp `save-memory-tool.ts`: mô tả tool là nơi DUY NHẤT dạy
 * model khi nào dùng, không có luật nào về ghi chú trong persona.
 *
 * Câu "chỉ bỏ câu dặn của người dùng" là cố ý: người dùng gửi thông báo rồi
 * thêm "ghi nhớ dòng tin này, khi nào tôi hỏi thì gửi lại" ngay trong cùng tin
 * (ca thật trên prod). Câu dặn đó không thuộc nội dung cần gửi lại.
 */
export const MO_TA_VERBATIM_NOTE = [
  "Lưu và gửi lại NGUYÊN VĂN một đoạn chữ người dùng nhờ giữ: thông báo, mẫu tin, lời cảm ơn, địa chỉ, danh sách... Khác save_memory (chỉ lưu tóm tắt ngắn về người dùng): tool này giữ đúng từng chữ để sau này gửi lại y hệt.",
  "Dùng khi người dùng gửi một đoạn kèm lời nhờ kiểu 'ghi nhớ tin này', 'lưu lại', 'nhớ giùm', 'khi nào tôi hỏi thì gửi lại'. Tên các ghi chú đã lưu nằm trong khối ghi_chu_da_luu của system prompt.",
  "",
  "action:",
  "- 'luu': tieu_de = tên ngắn để tìm lại (vd 'Thông báo suất ăn khóa thiền'). noi_dung = CHÉP NGUYÊN VĂN đoạn cần lưu từ tin nhắn: giữ từng chữ, lỗi chính tả, emoji, ký hiệu, xuống dòng. KHÔNG tóm tắt, KHÔNG sửa chữ, KHÔNG thêm tiêu đề hay ghi chú của bạn; chỉ bỏ câu dặn của người dùng (vd 'ghi nhớ dòng tin này...'). Máy chủ đối chiếu với tin gốc và từ chối nếu lệch.",
  "- 'doc': người dùng hỏi tới một ghi chú đã lưu. Gọi 'doc' rồi gửi lại ĐÚNG nội dung trả về, từng chữ: không thêm lời dẫn hay lời kết, không sửa, không tóm tắt, không đổi định dạng.",
  "- 'sua': người dùng đính chính MỘT CHỖ (đổi địa điểm, số điện thoại...). thay_doan = đoạn chữ cũ chép đúng từ ghi chú (chưa thấy nội dung thì 'doc' trước), thay_bang = chữ mới. Phần còn lại giữ nguyên.",
  "- 'thay': người dùng gửi BẢN MỚI thay cả ghi chú cũ. noi_dung chép nguyên văn bản mới, như 'luu'.",
  "- 'xoa': người dùng bảo bỏ ghi chú.",
  "",
  "Chỉ báo 'đã lưu' khi tool trả về thành công. Lưu xong trả lời ngắn gọn: đã lưu nguyên văn, với tên gì.",
].join("\n");
