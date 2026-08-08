/**
 * Mô tả tool `kb_search` cho model. Ngắn và nêu ĐÚNG lúc nên gọi: câu hỏi về
 * chính sách/giá/quy trình của chỗ mình thì tra kho trước khi trả lời bằng
 * trí nhớ chung - luật đầy đủ hơn nằm ở `persona-tool-rules.ts` (chỉ ghép khi
 * tool đang bật), ở đây chỉ là phần model đọc lúc quyết định GỌI tool nào.
 */
export const KB_SEARCH_DESCRIPTION =
  "Tra tài liệu nội bộ do chủ bot đã nạp lên Kho tri thức (chính sách, bảng giá, quy trình, " +
  "hướng dẫn). Dùng TRƯỚC khi trả lời câu hỏi về chính sách/giá/quy trình của chỗ mình - đừng " +
  "trả lời bằng trí nhớ chung khi có tool này. Trả về các đoạn liên quan nhất, mỗi đoạn kèm tên " +
  "nguồn để dẫn chứng lại cho người hỏi.";
