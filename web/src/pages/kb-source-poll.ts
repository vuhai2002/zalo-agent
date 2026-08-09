import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type KbSourceListItem } from "../dashboard-api-client";
import { nenHenLuotKe, type KetQuaTaiNguon } from "./kb-poll-guard";

const CHU_KY_MS = 4000;

/**
 * Tải + tự làm mới danh sách nguồn Kho tri thức cho trang Kho tri thức. DỪNG
 * hẳn khi không còn nguồn nào đang chờ worker xử lý (B7), nhưng KHÔNG CHẾT vì
 * một lần tải hỏng (Important 1, rà soát phase 06).
 *
 * Quyết định "có hẹn lượt poll kế tiếp" tính TƯỜNG MINH ngay trong promise
 * chain của chính lần tải đó (qua `nenHenLuotKe`), KHÔNG dựa vào việc React
 * state `sources` có đổi THAM CHIẾU hay không. Bug cũ: nhánh lỗi trả về ĐÚNG
 * tham chiếu cũ (`setSources(cu => cu ?? [])`), effect canh theo tham chiếu
 * đó không chạy lại nữa -> mất luôn lượt hẹn tiếp theo -> poll chết vĩnh viễn
 * sau đúng MỘT lần lỗi mạng dù nguồn vẫn còn `dang_xu_ly` thật.
 *
 * `sourcesDaBietRef` KHÔNG PHẢI `sources` (state hiển thị): nhánh lỗi có thể
 * đặt `sources` về mảng rỗng, nhưng ref này chỉ cập nhật ở nhánh THÀNH CÔNG -
 * luôn giữ đúng "việc đã biết gần nhất" để nhánh lỗi xét cho đúng.
 */
export function useKbSourcePoll() {
  const [sources, setSources] = useState<KbSourceListItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const sourcesDaBietRef = useRef<KbSourceListItem[] | null>(null);

  const motLanTai = useCallback(async (): Promise<KetQuaTaiNguon> => {
    try {
      const d = await api.kb.sources();
      sourcesDaBietRef.current = d.items;
      setSources(d.items);
      setLoadError("");
      return { thanhCong: true, items: d.items };
    } catch (err) {
      setSources((cu) => cu ?? []);
      setLoadError(err instanceof ApiError ? err.message : "Không tải được danh sách nguồn");
      return { thanhCong: false };
    }
  }, []);

  /** Làm mới NGAY theo hành động chủ động của người dùng - độc lập với chu kỳ poll tự động */
  const reload = useCallback(() => {
    void motLanTai();
  }, [motLanTai]);

  useEffect(() => {
    let huy = false;
    let timer: number | undefined;

    async function vongPoll() {
      const ketQua = await motLanTai();
      if (huy) return;
      if (nenHenLuotKe(ketQua, sourcesDaBietRef.current)) {
        timer = window.setTimeout(vongPoll, CHU_KY_MS);
      }
    }

    void vongPoll();
    return () => {
      huy = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [motLanTai]);

  return { sources, loadError, reload };
}
