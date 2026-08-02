/**
 * Đọc cột `disabled_tools` (JSON array key tool) một cách phòng thủ.
 *
 * Dùng chung cho CẢ `accounts` lẫn `agents` - hai bảng cùng lưu danh sách TẮT và
 * cùng giao nhau khi dựng bộ tool cho một lượt (xem `listAvailableTools`). Hai
 * bản sao của hàm này là mời gọi drift, mà drift ở đây nghĩa là một bảng lọc
 * chặt còn bảng kia cho lọt.
 *
 * Hỏng thì trả mảng RỖNG (= không tắt gì) chứ không ném: cột hỏng không được
 * phép làm chết cả lượt trả lời. Rỗng là hướng an toàn theo nghĩa khả dụng;
 * hướng an toàn theo nghĩa quyền hạn vẫn được giữ vì lớp còn lại (account) vẫn
 * lọc bình thường, và `runsInScheduledTurn` vẫn chặn lượt theo lịch.
 */
export function parseDisabledTools(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
