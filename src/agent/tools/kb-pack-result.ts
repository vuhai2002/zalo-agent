/**
 * Đóng gói danh sách đoạn ĐÃ ĐỊNH DẠNG (mỗi phần tử là một đoạn kèm nhãn
 * nguồn, xem `dinhDangDoan` ở `kb-search-tool.ts`) vào một ngân sách ký tự -
 * THAM LAM, và KHÔNG cắt giữa đoạn.
 *
 * Vì sao ĐÓNG GÓI TRƯỚC rồi mới BỌC (`wrapUntrustedContent`) ở caller: ngân
 * sách ở đây chỉ tính phần NỘI DUNG, không gồm phần vỏ (thẻ + ba dòng dặn dò).
 * Cách cũ bọc trước rồi cắt cả khối đã bọc, nên trần bao gồm luôn phần vỏ và
 * không cách nào chừa chỗ cho nó - cắt tới đâu hay tới đó, có thể cắt ngay
 * giữa MỘT ĐOẠN có nhãn nguồn, giữa một câu, thậm chí giữa một CON SỐ (giá
 * tiền, số ngày) - với một kho tri thức toàn dữ liệu kiểu đó, một mẩu câu cụt
 * vừa vô dụng vừa dễ bị model đọc/trích lại sai.
 *
 * Đoạn KHÔNG VỪA bị BỎ HẲN, không cắt giữa chừng - TRỪ đoạn ĐẦU TIÊN: nếu
 * ngay cả nó cũng không vừa (ngân sách quá nhỏ so với một đoạn), thà một đoạn
 * cụt còn hơn trả về rỗng, nên cắt nó ở ranh giới khoảng trắng gần nhất (không
 * cắt giữa từ) rồi ghi rõ đã rút gọn.
 *
 * Hàm THUẦN - không env, không DB, không log - cùng mẫu với
 * `../trim-context-to-budget.ts`.
 */

export const KB_PACK_SEPARATOR = "\n\n---\n\n";

const DANH_DAU_RUT_GON = "\n[...đoạn này đã rút gọn]";

/**
 * Cắt `s` về tối đa `gioiHan` ký tự, lùi về khoảng trắng gần nhất để không cắt
 * giữa từ. Không có khoảng trắng nào trong giới hạn (một "từ" dài hơn cả ngân
 * sách) thì đành cắt cứng - vẫn tốt hơn không trả gì. Giữ tối thiểu 1 ký tự để
 * luôn có gì đó khác rỗng.
 */
function catOKhoangTrang(s: string, gioiHan: number): string {
  const cho = Math.max(1, gioiHan);
  if (s.length <= cho) return s;
  const daCat = s.slice(0, cho);
  const viTri = daCat.lastIndexOf(" ");
  return viTri > 0 ? daCat.slice(0, viTri) : daCat;
}

/**
 * @param doanDaDinhDang mỗi phần tử là MỘT đoạn hoàn chỉnh (đã kèm nhãn nguồn)
 * @param nganSachNoiDung số ký tự tối đa cho phần NỘI DUNG (không gồm vỏ) -
 * caller tự trừ phần vỏ ra khỏi trần tổng trước khi gọi hàm này.
 */
export function dongGoiTheoNganSach(doanDaDinhDang: string[], nganSachNoiDung: number): string {
  let ketQua = "";
  for (const doan of doanDaDinhDang) {
    const ung = ketQua ? `${ketQua}${KB_PACK_SEPARATOR}${doan}` : doan;
    if (ung.length <= nganSachNoiDung) {
      ketQua = ung;
      continue;
    }

    if (ketQua === "") {
      // Đoạn ĐẦU TIÊN đã không vừa - cắt nó thay vì trả về rỗng hoàn toàn.
      const choNoiDung = Math.max(1, nganSachNoiDung - DANH_DAU_RUT_GON.length);
      ketQua = catOKhoangTrang(doan, choNoiDung) + DANH_DAU_RUT_GON;
    }
    // Ngân sách đã hết: các đoạn còn lại (kể cả đoạn vừa thử) bị BỎ HẲN, không
    // cắt giữa chừng - đây chính là điểm khác cách cũ.
    break;
  }
  return ketQua;
}
