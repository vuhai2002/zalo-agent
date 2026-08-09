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
 * Bỏ hẳn đoạn (dù ở nhánh "đã có ít nhất một đoạn trọn vẹn" hay nhánh "đoạn
 * ĐẦU TIÊN bị cắt mà vẫn còn đoạn khác phía sau") LUÔN kèm một dòng báo "còn N
 * đoạn nữa không đủ chỗ" (Important a, vòng rà soát lần 1 + lần 3): thiếu dòng
 * này thì model KHÔNG PHÂN BIỆT được "đã đọc hết top-k" với "bị cắt bớt vì hết
 * ngân sách" - đúng thứ dễ đẻ ra câu trả lời tự tin từ một kho tri thức đọc
 * thiếu mà không tự biết. Vòng rà soát lần 3 phát hiện nhánh "cắt đoạn đầu"
 * ban đầu VẪN thiếu dấu vết này khi còn đoạn khác chưa từng được xét.
 *
 * BẤT BIẾN CỨNG (vòng rà soát lần 3, sửa từ "mềm"): kết quả trả về KHÔNG BAO
 * GIỜ dài hơn `nganSachNoiDung`. Bản trước trừ ngân sách cho câu báo SAU khi
 * đã đóng gói xong (nối thêm rồi mới xong) - quét thật 31 cỡ đoạn x 201 mức
 * trần đo được 396 tổ hợp vượt trần. Bản này trừ TRƯỚC: dành sẵn chỗ cho câu
 * báo DÀI NHẤT có thể cần dùng (`nhanDaiNhat`, tính đúng ca xấu nhất - đoạn
 * đầu bị cắt VÀ còn N đoạn khác - CẢ HAI câu báo xuất hiện cùng lúc) rồi mới
 * đóng gói trong phần ngân sách còn lại. Xem chứng minh + test quét trong
 * `kb-pack-result.test.ts`.
 *
 * Hàm THUẦN - không env, không DB, không log - cùng mẫu với
 * `../trim-context-to-budget.ts`.
 */

export const KB_PACK_SEPARATOR = "\n\n---\n\n";

const DANH_DAU_RUT_GON = "\n[...đoạn này đã rút gọn]";
const danhDauConThieu = (soDoan: number) => `\n\n[...còn ${soDoan} đoạn nữa không đủ chỗ]`;

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
  // Dành sẵn chỗ cho câu báo DÀI NHẤT có thể cần dùng - TRƯỚC khi đóng gói,
  // không phải sau (xem docstring đầu file). `doanDaDinhDang.length` là chặn
  // trên an toàn cho N trong "còn N đoạn nữa" (N luôn <= tổng số đoạn).
  const nhanDaiNhat = DANH_DAU_RUT_GON.length + danhDauConThieu(doanDaDinhDang.length).length;
  const nganSachThuc = Math.max(1, nganSachNoiDung - nhanDaiNhat);

  let ketQua = "";
  for (let i = 0; i < doanDaDinhDang.length; i++) {
    const doan = doanDaDinhDang[i]!;
    const ung = ketQua ? `${ketQua}${KB_PACK_SEPARATOR}${doan}` : doan;
    if (ung.length <= nganSachThuc) {
      ketQua = ung;
      continue;
    }

    // conLai = đoạn hiện tại (vừa thất bại) + mọi đoạn phía sau chưa xét tới.
    const conLai = doanDaDinhDang.length - i;
    if (ketQua === "") {
      // Đoạn ĐẦU TIÊN đã không vừa - cắt nó thay vì trả về rỗng hoàn toàn.
      const choNoiDung = Math.max(1, nganSachThuc - DANH_DAU_RUT_GON.length);
      ketQua = catOKhoangTrang(doan, choNoiDung) + DANH_DAU_RUT_GON;
      // Đoạn đầu bị cắt KHÔNG có nghĩa nó là đoạn DUY NHẤT - còn đoạn khác
      // phía sau (chưa từng được thử, vì vòng lặp `break` ngay dưới) thì phải
      // báo luôn, không thì model tưởng "đoạn cụt này" là toàn bộ kết quả.
      if (conLai > 1) ketQua += danhDauConThieu(conLai - 1);
    } else {
      // Đã có ít nhất một đoạn trọn vẹn - đoạn NÀY và mọi đoạn còn lại đều bị
      // bỏ hẳn.
      ketQua += danhDauConThieu(conLai);
    }
    // Ngân sách đã hết: các đoạn còn lại bị BỎ HẲN, không cắt giữa chừng - đây
    // chính là điểm khác cách cũ.
    break;
  }
  return ketQua;
}
