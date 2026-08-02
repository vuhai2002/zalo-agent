/**
 * Đọc cột `disabled_tools` (JSON array key tool) một cách phòng thủ.
 *
 * Dùng chung cho CẢ `accounts` lẫn `agents` - hai bảng cùng lưu danh sách TẮT và
 * cùng giao nhau khi dựng bộ tool cho một lượt (xem `listAvailableTools`). Hai
 * bản sao của hàm này là mời gọi drift, mà drift ở đây nghĩa là một bảng lọc
 * chặt còn bảng kia cho lọt.
 *
 * Hỏng thì trả mảng RỖNG (= không tắt gì) chứ không ném: cột hỏng không được
 * phép làm chết cả lượt trả lời.
 *
 * Nói thẳng cái giá của lựa chọn đó: đây là fail-OPEN. Cột `accounts` hỏng thì
 * chính lớp chính sách mất tác dụng, cột `agents` hỏng thì lớp năng lực mất -
 * không có chuyện "lớp còn lại đỡ cho", vì hai lớp dùng chung hàm này. Chấp
 * nhận được vì cột chỉ hỏng khi ai đó sửa DB tay (mọi đường ghi đều đi qua
 * `JSON.stringify` của một mảng đã lọc bằng `TOOL_KEYS` ở biên API), và vì
 * `runsInScheduledTurn` cùng `available()` vẫn chặn độc lập với cột này.
 */
export function parseDisabledTools(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
