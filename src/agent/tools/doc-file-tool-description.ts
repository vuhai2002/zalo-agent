/** Mô tả tool `doc_file` cho model - tách riêng để chỉnh câu chữ không đụng logic */
export const MO_TA_DOC_FILE =
  "Đọc nội dung tệp người dùng gửi trong cuộc trò chuyện (pdf, docx, doc, xlsx, txt, csv, md; PDF quét được chép chữ bằng OCR). " +
  'Gọi ngay khi thấy [tệp đính kèm "..."] trong tin nhắn hoặc người dùng hỏi về một tệp đã gửi - đừng bảo họ gửi lại hay chụp màn hình. ' +
  'tepSo=1 là tệp mới nhất. Tệp quét dài chỉ được OCR sẵn vài trang đầu; cần trang khác thì truyền trang="6-15". ' +
  "Kết quả dài thì đọc tiếp bằng tuKyTu.";
