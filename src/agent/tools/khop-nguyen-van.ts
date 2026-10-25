/**
 * Kiểm một đoạn chữ model chép lại có đúng là NGUYÊN VĂN một đoạn trong tin
 * nhắn gần đây không, và trả về đúng đoạn GỐC để lưu.
 *
 * Vì sao phải kiểm ở máy chủ: đo trên model thật (gpt-combo), người dùng gửi
 * một thông báo kèm "ghi nhớ dòng tin này" thì 4/4 lần model TÓM TẮT hoặc chỉ
 * lưu đoạn cuối, rồi vẫn báo "đã ghi nhớ". Lời dặn trong mô tả tool không đủ;
 * phải có chỗ từ chối thật.
 *
 * Lưu đoạn GỐC chứ không lưu chữ model viết: model hay nuốt khoảng trắng thừa
 * ("Thông tin nhận:  " có hai dấu cách cuối dòng), nên so khớp bỏ qua khác biệt
 * khoảng trắng và ký tự vô hình, nhưng thứ được lưu là từng byte người dùng đã
 * gửi. Ngoài hai thứ đó (và chuẩn hóa NFC) thì phải khớp TỪNG KÝ TỰ, phân biệt
 * hoa thường, giữ cả lỗi chính tả: sửa "tài chánh" thành "tài chính" là hết
 * nguyên văn.
 *
 * Module THUẦN: không DB, không env.
 */

type ChuoiChuanHoa = {
  chu: string;
  /** batDau[i] = vị trí trong chuỗi gốc của đơn vị mã chuẩn hóa thứ i */
  batDau: number[];
  /** ketThuc[i] = vị trí NGAY SAU ký tự (hoặc cả cụm khoảng trắng) chứa đơn vị mã thứ i */
  ketThuc: number[];
};

/**
 * Ký tự định dạng vô hình (\p{Cf}: ZWNJ, ZWJ, BOM, ký tự Tags...). Bỏ qua ở CẢ
 * HAI phía khi so: đo trên model thật, nó hay chèn một ký tự loại này vào cuối
 * đoạn chép mà người đọc không thấy khác gì. Đoạn LƯU vẫn cắt từ chuỗi gốc nên
 * ZWJ bên trong emoji ghép của người dùng vẫn còn nguyên.
 */
const VO_HINH = /\p{Cf}/u;

/**
 * Gộp mỗi cụm khoảng trắng thành một dấu cách, bỏ ký tự vô hình, nhớ vị trí
 * gốc. Duyệt theo CODE POINT (ký tự Tags là cặp surrogate, xét từng nửa thì
 * \p{Cf} không nhận ra) nhưng ghi mảng vị trí theo ĐƠN VỊ MÃ, vì
 * `lastIndexOf` trả chỉ số đơn vị mã.
 */
function chuanHoaCoViTri(goc: string): ChuoiChuanHoa {
  const chu: string[] = [];
  const batDau: number[] = [];
  const ketThuc: number[] = [];
  let i = 0;
  while (i < goc.length) {
    const kyTu = String.fromCodePoint(goc.codePointAt(i)!);
    if (VO_HINH.test(kyTu)) {
      i += kyTu.length;
      continue;
    }
    if (/\s/.test(kyTu)) {
      const dau = i;
      while (i < goc.length && /\s/.test(goc[i]!) && !VO_HINH.test(goc[i]!)) i++;
      chu.push(" ");
      batDau.push(dau);
      ketThuc.push(i);
      continue;
    }
    for (let k = 0; k < kyTu.length; k++) {
      chu.push(kyTu[k]!);
      batDau.push(i);
      ketThuc.push(i + kyTu.length);
    }
    i += kyTu.length;
  }
  return { chu: chu.join(""), batDau, ketThuc };
}

function chuanHoaCanTim(chuoi: string): string {
  return chuoi.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * Phần thừa ở ĐUÔI được bỏ qua tối đa bao nhiêu ký tự. Đo trên model thật: chép
 * đúng cả đoạn rồi tự thêm rác ngay trước dấu đóng chuỗi (" server?", "།",
 * có lần cả một câu vô nghĩa 47 ký tự). Thử lại thì rác đổi khác nên có ca kẹt
 * tới khi chạm bộ chống lặp.
 */
const DUOI_THUA_TOI_DA = 60;

export type KetQuaKhopNguyenVan =
  | {
      ok: true;
      doanGoc: string;
      /** Có khi đã bỏ rác ở đuôi: phần bị bỏ, và tin gốc còn gì phía sau chỗ dừng */
      boDuoi?: { phanThua: string; tinGocConLai: string };
    }
  /**
   * `khopDuoc` = số ký tự đầu (đã chuẩn hóa) khớp được; `lechTu` = đoạn chữ
   * của model ngay chỗ bắt đầu lệch - để model tự soát lại đúng chỗ thay vì
   * chép lại cả đoạn mù quáng.
   */
  | { ok: false; khopDuoc: number; tongKyTu: number; lechTu: string };

/**
 * @param nguon tin nhắn gần đây theo thứ tự thời gian. Ghép lại bằng xuống
 *   dòng nên một đoạn trải qua hai tin liền nhau vẫn khớp được (người dùng hay
 *   gửi một thông báo thành hai tin). Khớp ở lần xuất hiện MỚI NHẤT.
 */
export function timDoanNguyenVan(canTim: string, nguon: readonly string[]): KetQuaKhopNguyenVan {
  const goc = nguon.join("\n").normalize("NFC");
  const haystack = chuanHoaCoViTri(goc);
  const can = chuanHoaCanTim(canTim);
  if (!can) return { ok: false, khopDuoc: 0, tongKyTu: 0, lechTu: "" };

  const viTri = haystack.chu.lastIndexOf(can);
  if (viTri >= 0) {
    const tu = haystack.batDau[viTri]!;
    const den = haystack.ketThuc[viTri + can.length - 1]!;
    return { ok: true, doanGoc: goc.slice(tu, den) };
  }

  // Tìm nhị phân độ dài tiền tố dài nhất còn khớp: tiền tố dài L có trong
  // nguồn thì mọi tiền tố ngắn hơn cũng có, nên phép thử đơn điệu.
  let thap = 0;
  let cao = can.length;
  while (thap < cao) {
    const giua = Math.ceil((thap + cao) / 2);
    if (haystack.chu.includes(can.slice(0, giua))) thap = giua;
    else cao = giua - 1;
  }

  return (
    thuBoDuoiThua(goc, haystack, can, thap) ?? {
      ok: false,
      khopDuoc: thap,
      tongKyTu: can.length,
      lechTu: can.slice(thap, thap + 40),
    }
  );
}

/**
 * Nhận đoạn đã khớp khi phần lệch CHỈ là rác ngắn ở đuôi. Điều kiện giữ an toàn
 * là phần khớp phải dừng ĐÚNG CUỐI MỘT DÒNG (hoặc cuối tin) của bản gốc: model
 * gõ sai chữ cuối thì phần khớp dừng giữa dòng và vẫn bị từ chối - không có điều
 * kiện này là lưu thiếu chữ cuối mà không ai hay.
 *
 * Ca còn hở: model BỎ hẳn dòng cuối rồi thêm rác - phần khớp vẫn dừng ở cuối
 * một dòng. Nên trả kèm `tinGocConLai` để tool đưa cho model tự xét.
 */
function thuBoDuoiThua(
  goc: string,
  haystack: ChuoiChuanHoa,
  can: string,
  khopDuoc: number,
): KetQuaKhopNguyenVan | null {
  let dai = khopDuoc;
  while (dai > 0 && can[dai - 1] === " ") dai--;
  const phanThua = can.slice(dai).trim();
  if (dai < 20 || !phanThua || phanThua.length > DUOI_THUA_TOI_DA || dai < phanThua.length * 3) {
    return null;
  }
  // "Phần thừa" có mặt trong tin gốc thì đó là chữ THẬT, không phải rác: model
  // bỏ sót một dòng ở giữa rồi chép tiếp dòng cuối. Coi nó là rác là lưu cụt.
  if (haystack.chu.includes(phanThua)) return null;

  const vt = haystack.chu.lastIndexOf(can.slice(0, dai));
  const tu = haystack.batDau[vt]!;
  const den = haystack.ketThuc[vt + dai - 1]!;
  const sau = goc.slice(den);
  if (!/^[^\S\n]*(\n|$)/.test(sau)) return null;
  return {
    ok: true,
    doanGoc: goc.slice(tu, den),
    boDuoi: { phanThua, tinGocConLai: sau.trim().slice(0, 80) },
  };
}
