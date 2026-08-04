import type { ReactNode } from "react";
import type { AgentDetailForm } from "./agent-detail-form";
import { AgentModelSection } from "./agent-model-section";
import { AgentToolsSection } from "./agent-tools-section";

/**
 * Bố cục 3 nhóm của form agent, dùng chung cho màn TẠO và màn SỬA.
 *
 * Tách ra vì hai màn khác nhau ở chỗ khác - nút bấm, cách lưu, cách hỏi trước
 * khi rời trang - chứ không phải ở cách xếp các nhóm. Để mỗi bên tự dựng thì
 * chỉnh cột bên này quên bên kia là hai màn lệch nhau ngay.
 *
 * Nhóm "Danh tính" truyền vào dạng node vì hai màn khai khác nhau: màn tạo cho
 * sửa id, màn sửa thì không.
 */
export function AgentFormLayout({
  danhTinh,
  form,
  onChange,
  soTaiKhoan,
}: {
  danhTinh: ReactNode;
  form: AgentDetailForm;
  onChange: (patch: Partial<AgentDetailForm>) => void;
  soTaiKhoan: number;
}) {
  return (
    <div className="space-y-5">
      {/* Danh tính bên trái, Model bên phải - hai nhóm ngắn, xếp dọc nối nhau
          thì trang dài ra mà nửa màn hình bên phải bỏ trống.
          KHÔNG `items-start`: để mặc định `stretch` cho hai thẻ cao BẰNG NHAU,
          mép dưới thẳng hàng. Thẻ nào ít nội dung hơn thì thừa khoảng trắng,
          đổi lại hai khối không so le. Dưới xl về một cột, nửa màn quá hẹp. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {danhTinh}
        <AgentModelSection form={form} onChange={onChange} />
      </div>
      {/* Công cụ chiếm trọn bề ngang: 13 dòng, mỗi dòng có mô tả riêng - nhét
          vào nửa màn là mô tả vỡ dòng liên tục */}
      <AgentToolsSection
        disabledTools={form.disabledTools}
        soTaiKhoan={soTaiKhoan}
        onChange={(disabledTools) => onChange({ disabledTools })}
      />
    </div>
  );
}
