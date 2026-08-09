/**
 * Câu cảnh báo trong hộp xác nhận khi xóa một nguồn Kho tri thức (I19).
 *
 * Trước đây hộp thoại chỉ nói chung chung "không khôi phục được" - không hề
 * nói RÕ có bao nhiêu agent đang tra nguồn này, nên xóa xong agent mất quyền
 * đọc mà không ai từng được cảnh báo trước. `agentIds: null` = route
 * `GET /sources/:id/agents` gọi thất bại (mất mạng, server lỗi) - vẫn phải
 * cho xóa được (không chặn cả luồng chỉ vì không đếm được), nhưng câu chữ
 * phải THÀNH THẬT là "không kiểm tra được", không được ngầm định là 0.
 */
export function xayThongDiepXoaNguon(agentIds: string[] | null): string {
  const veSau = "Toàn bộ đoạn đã cắt của nguồn này cũng bị xóa, không khôi phục được.";
  if (agentIds === null) {
    return `Không kiểm tra được có agent nào đang dùng nguồn này không. ${veSau}`;
  }
  if (agentIds.length === 0) {
    return `Chưa agent nào dùng nguồn này. ${veSau}`;
  }
  return `${agentIds.length} agent đang dùng nguồn này sẽ mất quyền tra cứu nội dung này ngay khi xóa. ${veSau}`;
}
