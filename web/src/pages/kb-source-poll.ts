import { useEffect, useRef, useState } from "react";
import { api, ApiError, type KbSourceListItem } from "../dashboard-api-client";
import { taoVongPoll } from "./kb-poll-loop";
import type { KetQuaTaiNguon } from "./kb-poll-guard";

/**
 * Tải + tự làm mới danh sách nguồn Kho tri thức cho trang Kho tri thức. Chỉ
 * còn là LỚP VỎ MỎNG nối `window.setTimeout`/`window.clearTimeout` vào vòng
 * lặp THUẦN `taoVongPoll` (`kb-poll-loop.ts`) - mọi quyết định "có hẹn lượt
 * kế hay không" và "có áp kết quả vào UI hay không" nằm bên đó, đã test đủ 7
 * bất biến bằng đồng hồ giả.
 *
 * `reload()` trả thẳng `vongRef.current!.reload()` - KHÔNG tự tải một lần
 * riêng: bug hồi quy đã sửa (07d726c) là `reload` từng gọi thẳng một lần tải
 * không đi qua vòng lặp, nên MỘT KHI poll đã dừng (hết việc - trạng thái nghỉ
 * bình thường của trang) thì không gì hồi sinh được nó nữa. `tai`/`apDung`
 * tách rời (chiều 7): `tai` chỉ fetch, `apDung` (setSources/setLoadError) chỉ
 * được gọi cho lượt MỚI NHẤT - hai lượt tải bay chồng nhau, về đảo thứ tự,
 * không làm UI lùi lại bản cũ.
 */
export function useKbSourcePoll() {
  const [sources, setSources] = useState<KbSourceListItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const vongRef = useRef<ReturnType<typeof taoVongPoll<KbSourceListItem>> | null>(null);

  useEffect(() => {
    const vong = taoVongPoll<KbSourceListItem>({
      // THUẦN - không đụng state ở đây (chiều 7): hai lượt tải bay chồng
      // nhau, về đảo thứ tự thì lượt cũ vẫn PHẢI tải xong bình thường (không
      // hủy được request đang bay), chỉ là kết quả của nó không được ÁP DỤNG.
      tai: async (): Promise<KetQuaTaiNguon<KbSourceListItem>> => {
        try {
          const d = await api.kb.sources();
          return { thanhCong: true, items: d.items };
        } catch (err) {
          return { thanhCong: false, loi: err instanceof ApiError ? err.message : "Không tải được danh sách nguồn" };
        }
      },
      // `taoVongPoll` chỉ gọi hàm này cho lượt MỚI NHẤT - lượt cũ về muộn
      // không bao giờ chạm tới đây, UI không thể lùi lại bản cũ.
      apDung: (ketQua) => {
        if (ketQua.thanhCong) {
          setSources(ketQua.items);
          setLoadError("");
        } else {
          setSources((cu) => cu ?? []);
          setLoadError(ketQua.loi ?? "Không tải được danh sách nguồn");
        }
      },
      henGio: (chay, ms) => window.setTimeout(chay, ms),
      xoaGio: (tayCam) => window.clearTimeout(tayCam as number),
    });
    vongRef.current = vong;
    void vong.batDau();
    return () => vong.dungHan();
  }, []);

  const reload = () => void vongRef.current?.reload();

  return { sources, loadError, reload };
}
