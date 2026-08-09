/**
 * So sánh tick hiện tại của khối "Kho tri thức" (trang sửa agent) với bản đã
 * lưu gần nhất - tách khỏi component để test được không cần dựng DOM.
 *
 * I17: khối này giữ state riêng (không đi qua `AgentDetailForm`), nên chốt rời
 * trang chung của cả trang (`useUnsavedChangesPrompt`) không tự biết khối này
 * còn thay đổi chưa lưu. Kết quả của hàm này là NGUỒN SỰ THẬT mà component
 * dùng để báo lên trang cha qua `onDirtyChange` - gạt 1 nguồn rồi bấm "Quay
 * lại" phải bị hỏi lại, lưu xong thì không.
 */
export function laCoDoiNguon(checked: Set<string>, banDau: Set<string>): boolean {
  if (checked.size !== banDau.size) return true;
  for (const id of checked) {
    if (!banDau.has(id)) return true;
  }
  return false;
}
