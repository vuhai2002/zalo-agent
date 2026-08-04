import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Chốt đóng modal/drawer khi bấm ra nền.
 *
 * Vì sao không đơn giản là `onClick={onClose}` trên div nền: trình duyệt bắn
 * `click` lên TỔ TIÊN CHUNG gần nhất của điểm bấm xuống và điểm thả. Bôi đen
 * chữ trong ô nhập rồi lỡ tay kéo quá mép modal thì mousedown ở trong panel,
 * mouseup ở ngoài nền, tổ tiên chung chính là div nền - `onClick` của nền chạy
 * và modal đóng, mất sạch nội dung đang gõ. Cái `onClick={e =>
 * e.stopPropagation()}` hay gắn trên panel KHÔNG cứu được: sự kiện click đó
 * không hề đi qua panel.
 *
 * Cách chắc chắn: chỉ đóng khi CẢ điểm bấm xuống LẪN điểm thả đều rơi đúng vào
 * div nền. Hệ quả: bấm ngoài rồi thả vào trong panel cũng không đóng - đúng ý
 * "chỉ nhấp hẳn bên ngoài mới tắt", và an toàn hơn cho ô persona 8.000 ký tự.
 */

/**
 * Phần quyết định, tách khỏi React để test được cả CHUỖI thao tác chứ không chỉ
 * một phép and. Cờ phải tự xóa sau mỗi lần thả, nếu không một cú click lạc
 * (không có pointerdown đi trước, vd click do bàn phím sinh ra) sẽ ăn theo cờ
 * còn sót của lần kéo trước.
 */
export function taoChotNen(onClose: () => void) {
  let batDauONen = false;
  return {
    bamXuong(trenNen: boolean) {
      batDauONen = trenNen;
    },
    tha(trenNen: boolean) {
      const dong = batDauONen && trenNen;
      batDauONen = false;
      if (dong) onClose();
    },
  };
}

/** Rải thẳng vào div nền: `<div className="fixed inset-0 ..." {...nen}>` */
export function useChotNen(onClose: () => void) {
  const batDauONen = useRef(false);
  return {
    onPointerDown: (e: PointerEvent) => {
      batDauONen.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent) => {
      const dong = batDauONen.current && e.target === e.currentTarget;
      batDauONen.current = false;
      if (dong) onClose();
    },
  };
}
