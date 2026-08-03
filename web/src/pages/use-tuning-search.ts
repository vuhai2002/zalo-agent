import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { TuningDef } from "../dashboard-api-client";
import { foldForSearch } from "../shared/fold-for-search";

/**
 * Tìm tham số trên trang Cấu hình, rồi tự chuyển nav sang ĐÚNG nhóm chứa kết
 * quả đầu tiên - người dùng gõ "trần tin" không cần biết trước nó nằm ở nhóm
 * "Lịch hẹn".
 *
 * Tách khỏi `tuning-page.tsx` vì đây là một mối bận tâm riêng (lọc + điều
 * hướng), và tách ra thì trang chính còn đúng phần bố cục.
 *
 * @returns danh sách key khớp, hoặc `null` khi ô tìm đang trống
 */
export function useTimKiemTuning(defs: Record<string, TuningDef>, tuKhoa: string): string[] | null {
  const navigate = useNavigate();

  // Khớp NHÃN tiếng Việt lẫn TÊN biến lẫn phần mô tả, bỏ dấu để gõ không dấu
  // vẫn ra. Ba trường xét riêng chứ không nối lại: nối chuỗi thì một từ khóa
  // vắt qua ranh giới nhãn và mô tả cũng khớp, ra kết quả khó hiểu.
  const ketQua = useMemo(() => {
    const q = foldForSearch(tuKhoa);
    if (!q) return null;
    return Object.keys(defs).filter(
      (k) =>
        foldForSearch(defs[k]!.label).includes(q) ||
        foldForSearch(k).includes(q) ||
        foldForSearch(defs[k]!.hint).includes(q),
    );
  }, [tuKhoa, defs]);

  useEffect(() => {
    if (!ketQua?.length) return;
    const nhomDauTien = defs[ketQua[0]!]?.group;
    // `replace` để gõ tìm kiếm không đẻ ra một mục lịch sử mỗi ký tự - bấm Back
    // sau khi tìm phải quay về trang trước, không phải lùi từng chữ vừa gõ.
    if (nhomDauTien) navigate(`/tuning/${nhomDauTien}`, { replace: true });
  }, [ketQua, defs, navigate]);

  return ketQua;
}
