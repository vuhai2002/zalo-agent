/**
 * Chờ tới khi một điều kiện đúng, thay cho `await sleep(N)` rồi khẳng định.
 *
 * VÌ SAO CẦN: `sleep(N)` không đo thứ test quan tâm - nó đo ĐỒNG HỒ TREO
 * TƯỜNG. Máy rảnh thì N đủ, máy bận thì việc chưa xong nên số đếm hụt và test
 * đỏ dù code hoàn toàn đúng. Đo thật trên repo này: chạy cả bộ dưới 6 tiến
 * trình đốt CPU, trên HEAD sạch, 4/5 lượt đỏ; máy rảnh thì 2136/2136 xanh.
 *
 * Nguy hiểm không nằm ở chỗ nó đỏ oan mà ở chỗ nó DẠY NGƯỜI TA BỎ QUA MÀU ĐỎ:
 * chạy lại thấy xanh vài lần là hình thành phản xạ "chắc lại nhấp nháy", rồi
 * một ngày nó đỏ vì lỗi thật và bị chạy lại cho qua.
 *
 * KHÔNG phải nới biên. Nới `sleep(20)` thành `sleep(200)` chỉ đẩy ngưỡng đỏ ra
 * xa hơn và làm chậm bộ test trên MỌI máy. Đổi phép đo thì được ba thứ:
 *  - máy bận vẫn xanh (trần rộng, nhưng chỉ tiêu khi thật sự cần)
 *  - code sai vẫn đỏ (hết trần thì ném, kèm mô tả nói rõ đang chờ gì)
 *  - máy rảnh CHẠY NHANH HƠN sleep cố định, vì trả về ngay khi điều kiện đúng
 *
 * GIỚI HẠN - đọc trước khi dùng: hàm này chỉ hợp với khẳng định KHẲNG ĐỊNH
 * ("rồi cũng phải xảy ra"). Với khẳng định PHỦ ĐỊNH ("đúng 1 lần, không có lần
 * thứ hai") nó vô dụng, vì điều kiện đúng ngay ở lần thử đầu rồi trả về, chưa
 * chứng minh được điều gì về tương lai. Chỗ đó phải neo vào một mốc xác định
 * (đợi đúng thứ sinh ra lần thứ hai chạy xong) hoặc tiêm đồng hồ giả.
 */

const nguPhut = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type TuyChonDoiCho = {
  /**
   * Trần thời gian chờ. Mặc định 5 giây - RỘNG có chủ đích: nó chỉ bị tiêu
   * trọn khi code THẬT SỰ sai, còn đường xanh thì thoát ngay lúc điều kiện
   * đúng nên trần lớn không làm bộ test chậm đi.
   */
  tranMs?: number;
  /** Khoảng giữa hai lần thử. Mặc định 5ms - đủ mịn mà không quay CPU. */
  nhipMs?: number;
  /** Đang chờ điều gì. Đi thẳng vào thông điệp lỗi lúc hết trần. */
  moTa?: string;
};

/**
 * Thử `dieuKien()` cho tới khi nó trả về `true`, hoặc ném khi hết `tranMs`.
 *
 * `dieuKien` được gọi NGAY một lần trước khi ngủ lần đầu: việc đã xong sẵn thì
 * không tốn một nhịp nào.
 *
 * Điều kiện ném lỗi thì coi như CHƯA đúng và thử lại - đúng lúc đang chờ, thứ
 * cần đọc thường chưa tồn tại (dòng DB chưa có, mảng còn rỗng). Lỗi của lần
 * thử CUỐI được kèm vào thông điệp để không nuốt mất nguyên nhân thật.
 */
export async function doiChoDenKhi(
  dieuKien: () => boolean | Promise<boolean>,
  tuyChon: TuyChonDoiCho = {},
): Promise<void> {
  const tranMs = tuyChon.tranMs ?? 5000;
  const nhipMs = tuyChon.nhipMs ?? 5;
  const moTa = tuyChon.moTa ?? "điều kiện";
  const hetHan = Date.now() + tranMs;

  let loiCuoi: unknown;
  for (;;) {
    try {
      if (await dieuKien()) return;
      loiCuoi = undefined;
    } catch (err) {
      loiCuoi = err;
    }
    if (Date.now() >= hetHan) {
      const duoi = loiCuoi === undefined ? "" : ` - lần thử cuối ném: ${String(loiCuoi)}`;
      throw new Error(`Hết ${tranMs}ms mà chưa thấy: ${moTa}${duoi}`);
    }
    await nguPhut(nhipMs);
  }
}

/**
 * Dạng hay dùng nhất: chờ tới khi một bộ đếm đạt ngưỡng.
 *
 * Tách riêng vì thông điệp lỗi nói được SỐ THẬT lúc hết trần ("mong >= 3, dừng
 * ở 2") - thứ mà `doiChoDenKhi` với một hàm boolean trần không nói ra được, mà
 * đó lại đúng là thông tin cần nhất khi ngồi đọc log CI.
 */
export async function doiChoSoLuong(
  dem: () => number,
  toiThieu: number,
  tuyChon: TuyChonDoiCho = {},
): Promise<void> {
  const tranMs = tuyChon.tranMs ?? 5000;
  const moTa = tuyChon.moTa ?? "số lượng";
  try {
    await doiChoDenKhi(() => dem() >= toiThieu, { ...tuyChon, moTa });
  } catch {
    // Đọc `dem()` LẠI ở đây chứ không dựng sẵn chuỗi lúc gọi: con số cần in ra
    // là con số lúc HẾT TRẦN, không phải lúc bắt đầu chờ.
    throw new Error(`Hết ${tranMs}ms mà ${moTa} chỉ đạt ${dem()}, mong >= ${toiThieu}`);
  }
}
