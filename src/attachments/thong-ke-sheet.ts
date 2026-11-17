import type { SheetDaDoc } from "../knowledge/extract-xlsx-sheets.js";
import { chiSoThanhChuCot } from "../knowledge/xlsx-cell-ref.js";
import type { ThongKeCot, ThongKeSheet } from "./attachment-extract-types.js";

/**
 * Số liệu MÁY CHỦ tự cộng cho một sheet - để model không phải cộng nhẩm hàng
 * trăm ô (ca thật trên prod: "tổng số cây mỗi sheet trong từng file").
 *
 * Chỉ cộng ô KIỂU SỐ trong XML (giá trị thô, không phụ thuộc định dạng hiển
 * thị) nên không phải đoán "9.356" là nghìn hay thập phân. Bỏ ô CÔNG THỨC: ô
 * công thức thường là dòng TỔNG, cộng vào là đếm hai lần. Dòng tổng GÕ TAY
 * thì không phân biệt được - kết quả tool phải nói rõ quy tắc cộng.
 *
 * Dòng tiêu đề = hàng có chữ CUỐI CÙNG đứng trước hàng đầu tiên có ô số -
 * bảng tiếng Việt hay có dòng tựa ("BÁO CÁO THÁNG 3") nằm trên dòng tiêu đề
 * thật. Không có hàng số nào thì lấy hàng chữ đầu tiên.
 *
 * Giới hạn biết trước: ngày trong Excel lưu dạng số serial nên cột NGÀY cũng
 * có "tổng" - vô nghĩa nhưng vô hại; kết quả tool nói rõ quy tắc cộng.
 */

/** Làm tròn khử sai số dấu phẩy động (0,1 + 0,2) - 10 chữ số thập phân là thừa cho mọi bảng thật */
const lamTron = (n: number) => Math.round(n * 1e10) / 1e10;

export function thongKeSheet(sheet: SheetDaDoc): ThongKeSheet {
  const coChu = (h: SheetDaDoc["hang"][number]) => h.some((o) => !o.laSo && o.giaTri.trim() !== "");
  const hangSoDau = sheet.hang.findIndex((h) => h.some((o) => o.laSo && !o.laCongThuc));
  let truocSo = -1;
  for (let i = hangSoDau - 1; i >= 0 && truocSo < 0; i--) if (coChu(sheet.hang[i]!)) truocSo = i;
  const viTriTieuDe = truocSo >= 0 ? truocSo : sheet.hang.findIndex(coChu);
  if (viTriTieuDe < 0) return { soHangDuLieu: 0, cot: [], soOCongThuc: 0 };
  const tieuDe = sheet.hang[viTriTieuDe]!;
  const duLieu = sheet.hang.slice(viTriTieuDe + 1).filter((h) => h.some((o) => o.giaTri.trim() !== ""));

  const tong = new Map<number, { tong: number; soO: number }>();
  let soOCongThuc = 0;
  for (const hang of duLieu) {
    hang.forEach((o, cot) => {
      if (o.laCongThuc) {
        soOCongThuc++;
        return;
      }
      if (!o.laSo) return;
      const t = tong.get(cot) ?? { tong: 0, soO: 0 };
      t.tong += Number(o.giaTri);
      t.soO++;
      tong.set(cot, t);
    });
  }

  const cot: ThongKeCot[] = [...tong.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, t]) => ({ cot: tieuDe[i]?.giaTri.trim() || chiSoThanhChuCot(i + 1), tong: lamTron(t.tong), soO: t.soO }));
  return { soHangDuLieu: duLieu.length, cot, soOCongThuc };
}
