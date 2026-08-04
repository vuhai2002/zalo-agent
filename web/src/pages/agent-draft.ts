import type { AgentDetailForm } from "./agent-detail-form";

/**
 * Bản nhập của màn "Tạo agent mới": modal chỉ thu thập rồi chuyển sang trang
 * tạo, KHÔNG ghi gì vào DB. Agent chỉ thật sự sinh ra khi bấm nút Tạo ở trang
 * đó - trước đó bấm Hủy là mất trắng, đúng nghĩa "chưa tạo".
 */
export type BanNhapAgent = {
  id: string;
  name: string;
  icon: string;
  persona: string;
};

/**
 * Đường dẫn trang tạo. Mở đầu bằng gạch dưới nên KHÔNG bao giờ đụng id agent
 * thật: `createSchema` phía server bắt id khớp `/^[a-z0-9][a-z0-9-]*$/`, tức
 * phải bắt đầu bằng chữ thường hoặc số. Đặt là "/agents/new" thì một agent lỡ
 * mang id "new" sẽ bị route này che mất và không còn đường vào sửa.
 */
export const DUONG_DAN_TAO = "/agents/_new";

/** Bản nhập -> form của trang. Mọi ô override để rỗng = theo trang Cấu hình. */
export function tuBanNhap(banNhap: BanNhapAgent): AgentDetailForm {
  return {
    icon: banNhap.icon,
    name: banNhap.name,
    persona: banNhap.persona,
    maxSteps: "",
    reasoningEffort: "",
    disabledTools: [],
    contextWindow: "",
  };
}

/**
 * Sau khi POST có cần PATCH thêm một nhịp không.
 *
 * `POST /api/agents` chỉ nhận id/name/icon/persona (`createSchema` ở
 * `src/server/routes/agent-routes.ts`), không nhận model override lẫn danh sách
 * tool tắt. Ai chỉnh mấy ô đó ngay ở màn tạo thì phải gửi tiếp một PATCH, còn
 * để nguyên mặc định thì một lần POST là xong - đây là ca thường gặp nên không
 * bắn request thừa.
 */
export function canPatchSauKhiTao(form: AgentDetailForm): boolean {
  return (
    form.maxSteps.trim() !== "" ||
    form.reasoningEffort !== "" ||
    form.contextWindow.trim() !== "" ||
    form.disabledTools.length > 0
  );
}

/** Trùng id thì phải chặn NGAY ở modal: trang tạo mới báo thì đã gõ xong persona */
export function idDaCoRoi(id: string, idDangCo: string[]): boolean {
  return id !== "" && idDangCo.includes(id);
}
