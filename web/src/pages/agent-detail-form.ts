import type { ManagedAgent, ReasoningEffort } from "../dashboard-api-client";
import type { AgentIdentityForm } from "./agent-identity-section";
import { kiemSoBuoc, kiemTranContext } from "./agent-field-validators";
import type { AgentModelForm } from "./agent-model-section";

/**
 * Ánh xạ giữa bản ghi agent và trạng thái form của trang sửa.
 *
 * Tách khỏi component vì đây là logic thuần, không dính React - và vì hai chiều
 * chuyển đổi phải soi gương nhau: chỗ nào `null` thành `""` lúc đọc thì lúc ghi
 * phải trả về `null`. Để lẫn trong component thì hai chiều dễ trôi khỏi nhau.
 */
export type AgentDetailForm = AgentIdentityForm &
  AgentModelForm & { disabledTools: string[]; contextWindow: string };

/**
 * Nhận cả bản ghi KHÔNG có `accountCount` (response của PATCH trả bản ghi thô,
 * chỉ `list()` mới cộng cột đó) - hàm này không đụng tới trường đó, bắt buộc nó
 * chỉ tổ ép caller bịa ra một con số.
 */
export function tuAgent(a: Omit<ManagedAgent, "accountCount">): AgentDetailForm {
  return {
    icon: a.icon,
    name: a.name,
    persona: a.persona,
    // Chuỗi rỗng = "theo cấu hình chung"; gửi lên thành null
    maxSteps: a.maxSteps == null ? "" : String(a.maxSteps),
    reasoningEffort: a.reasoningEffort ?? "",
    // Sắp xếp để so sánh dirty bằng JSON.stringify không phụ thuộc thứ tự tick
    disabledTools: [...a.disabledTools].sort(),
    contextWindow: a.contextWindow == null ? "" : String(a.contextWindow),
  };
}

/** Form -> body PATCH. Chuỗi rỗng thành `null` = bỏ override, theo cấu hình chung. */
export function thanhPatch(form: AgentDetailForm) {
  const soBuoc = form.maxSteps.trim();
  return {
    icon: form.icon,
    name: form.name.trim(),
    persona: form.persona,
    // LUÔN null: hai ô này đã gỡ khỏi giao diện (xem agent-model-section.tsx),
    // agent luôn dùng nhà cung cấp và model của cấu hình chung. Gửi null thay
    // vì bỏ qua trường, để bản ghi cũ còn giá trị được dọn ngay lần Lưu kế
    // tiếp - bỏ qua thì nó nằm lại trong DB, vẫn tác động bot mà không còn ô
    // nào sửa được.
    modelProvider: null,
    modelName: null,
    maxSteps: soBuoc === "" ? null : Number(soBuoc),
    reasoningEffort: form.reasoningEffort === "" ? null : (form.reasoningEffort as ReasoningEffort),
    disabledTools: form.disabledTools,
    contextWindow: form.contextWindow.trim() === "" ? null : Number(form.contextWindow.trim()),
  };
}

/**
 * Kiểm cả form TRƯỚC khi gửi, bằng đúng luật của `patchSchema` phía server.
 * Trả chuỗi rỗng nghĩa là hợp lệ.
 *
 * Có hàm này vì server gộp mọi lỗi zod thành đúng một câu "Dữ liệu không hợp
 * lệ" và client vứt mảng `issues` - nên không nói được là ô nào sai.
 */
export function kiemForm(form: AgentDetailForm): string {
  const loiSoBuoc = kiemSoBuoc(form.maxSteps);
  if (loiSoBuoc) return `Số bước tối đa: ${loiSoBuoc.toLowerCase()}`;
  if (form.icon.trim() === "") return "Icon không được để trống";
  if (form.name.trim() === "") return "Tên hiển thị không được để trống";
  const loiTran = kiemTranContext(form.contextWindow);
  if (loiTran) return `Trần context: ${loiTran.toLowerCase()}`;
  return "";
}
