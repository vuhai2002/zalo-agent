import { useEffect, useRef, useState } from "react";
import { api, ApiError, type KbSourceListItem } from "../dashboard-api-client";
import { taoVongPoll } from "./kb-poll-loop";
import type { KetQuaTaiNguon } from "./kb-poll-guard";

/**
 * Tải + tự làm mới danh sách nguồn Kho tri thức cho trang Kho tri thức. Chỉ
 * còn là LỚP VỎ MỎNG nối `window.setTimeout`/`window.clearTimeout` vào vòng
 * lặp THUẦN `taoVongPoll` (`kb-poll-loop.ts`) - mọi quyết định "có hẹn lượt
 * kế hay không" nằm bên đó, đã test đủ 6 bất biến bằng đồng hồ giả.
 *
 * `reload()` trả thẳng `vongRef.current!.reload()` - KHÔNG tự tải một lần
 * riêng: bug hồi quy đã sửa (07d726c) là `reload` từng gọi thẳng một lần tải
 * không đi qua vòng lặp, nên MỘT KHI poll đã dừng (hết việc - trạng thái nghỉ
 * bình thường của trang) thì không gì hồi sinh được nó nữa.
 */
export function useKbSourcePoll() {
  const [sources, setSources] = useState<KbSourceListItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const vongRef = useRef<ReturnType<typeof taoVongPoll> | null>(null);

  useEffect(() => {
    const vong = taoVongPoll({
      tai: async (): Promise<KetQuaTaiNguon> => {
        try {
          const d = await api.kb.sources();
          setSources(d.items);
          setLoadError("");
          return { thanhCong: true, items: d.items };
        } catch (err) {
          setSources((cu) => cu ?? []);
          setLoadError(err instanceof ApiError ? err.message : "Không tải được danh sách nguồn");
          return { thanhCong: false };
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
