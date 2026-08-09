import { useCallback, useState } from "react";

/**
 * Cầu nối giữa khối "Kho tri thức" (state riêng, không đi qua `AgentDetailForm`)
 * và phần còn lại của trang sửa agent. Tách khỏi `agent-detail-page.tsx` để
 * file đó không phình thêm khi ráp dây hai việc:
 *
 * 1. Gộp cờ dirty của khối KB vào chốt rời trang chung (I17) - khối KB tick
 *    xong chưa lưu vẫn phải bị hỏi khi rời trang, y hệt các ô khác của form.
 * 2. Báo cho khối Công cụ tải lại catalog SAU KHI lưu nguồn xong (I18 phần 1) -
 *    badge kb_search đổi "chưa cấu hình" -> dùng được ngay, không phải F5.
 */
export function useAgentKbRefreshBridge() {
  const [kbDirty, setKbDirty] = useState(false);
  const [kbRefreshSignal, setKbRefreshSignal] = useState(0);
  const onKbSaved = useCallback(() => setKbRefreshSignal((n) => n + 1), []);

  return { kbDirty, onKbDirtyChange: setKbDirty, kbRefreshSignal, onKbSaved };
}
