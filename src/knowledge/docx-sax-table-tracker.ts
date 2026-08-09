/**
 * Theo dõi bảng Word (`<w:tbl>`) qua NGĂN XẾP, tách khỏi
 * `docx-sax-paragraph-builder.ts` để file đó không vượt 200 dòng.
 *
 * Vì sao ngăn xếp chứ không phải biến đơn: bảng lồng trong ô là cấu trúc hợp
 * lệ và phổ biến (biểu mẫu, hoá đơn Word). Biến đơn (`hangCuaBang`/`oCuaHang`
 * dùng chung cho MỌI cấp bảng) khiến bảng lồng vừa mở ra là GHI ĐÈ lên trạng
 * thái của bảng NGOÀI đang dang dở - đo được: một hàng của bảng ngoài biến
 * mất hoàn toàn, chữ trong ô trước bảng lồng cũng mất, và bảng lồng thoát ra
 * thành một "đoạn" đứng SAI vị trí thay vì nằm trong đúng ô của nó. Ngăn xếp
 * cho MỖI cấp bảng một trạng thái riêng, đè lồng nhau đúng cách.
 */

type BangFrame = { hangCuaBang: string[]; oCuaHang: string[]; boDemO: string };

export type DocxTableTracker = {
  /** `<w:tbl>` mở - đẩy một trạng thái bảng mới lên đỉnh ngăn xếp */
  moBang(): void;
  /** `<w:tbl>` đóng - lấy trạng thái ra, đổ kết quả vào Ô của bảng NGOÀI
   * (nếu có, tức bảng lồng) hoặc thành một "đoạn" độc lập (bảng gốc). */
  dongBang(themDoan: (text: string) => void): void;
  /** `<w:tr>` mở - reset danh sách ô của hàng hiện tại (bảng TRONG CÙNG) */
  moHang(): void;
  /** `<w:tr>` đóng - chốt hàng nếu có ô nào không rỗng */
  dongHang(): void;
  /** `<w:tc>` mở - reset buffer chữ của ô đang mở (bảng TRONG CÙNG) */
  moO(): void;
  /** `<w:tc>` đóng - chốt ô vào danh sách ô của hàng hiện tại */
  dongO(): void;
  /** Đang trong MỘT ô nào đó (ở bất kỳ cấp bảng nào) hay không */
  dangTrongO(): boolean;
  /** Đổ thêm chữ (một đoạn văn vừa kết thúc) vào Ô đang mở của bảng TRONG
   * CÙNG - gọi khi `dangTrongO()` true. */
  themVaoODangMo(vanBan: string): void;
};

export function taoDocxTableTracker(): DocxTableTracker {
  const bangStack: BangFrame[] = []; // đỉnh = bảng TRONG CÙNG đang mở
  let doSauO = 0; // độ sâu <w:tc> đang mở, tính trên MỌI cấp bảng

  return {
    moBang() {
      bangStack.push({ hangCuaBang: [], oCuaHang: [], boDemO: "" });
    },
    dongBang(themDoan) {
      const xong = bangStack.pop();
      if (!xong || xong.hangCuaBang.length === 0) return;
      const ngoai = bangStack[bangStack.length - 1];
      if (ngoai) {
        // Bảng LỒNG: nối hàng bằng "; " (KHÔNG phải "\n") để nhúng vào ô của
        // bảng ngoài mà VẪN giữ đúng 1 dòng. "1 hàng = 1 dòng" là bất biến
        // xuyên suốt cả builder này lẫn xlsx-sax-sheet-builder.ts -
        // catThanhDoan (chunk-text.ts) cắt đoạn theo DÒNG, nối bằng "\n" ở
        // đây sẽ khiến hàng NGOÀI (chứa bảng lồng) vắt qua nhiều dòng và bị
        // xẻ đôi giữa 2 chunk khác nhau.
        ngoai.boDemO += (ngoai.boDemO ? " " : "") + xong.hangCuaBang.join("; ");
      } else {
        themDoan(xong.hangCuaBang.join("\n")); // bảng GỐC: giữ "1 hàng = 1 dòng"
      }
    },
    moHang() {
      const dinh = bangStack[bangStack.length - 1];
      if (dinh) dinh.oCuaHang = [];
    },
    dongHang() {
      const dinh = bangStack[bangStack.length - 1];
      if (dinh && dinh.oCuaHang.some((o) => o.trim())) dinh.hangCuaBang.push(dinh.oCuaHang.join(" | "));
    },
    moO() {
      doSauO++;
      const dinh = bangStack[bangStack.length - 1];
      if (dinh) dinh.boDemO = "";
    },
    dongO() {
      doSauO--;
      const dinh = bangStack[bangStack.length - 1];
      if (dinh) dinh.oCuaHang.push(dinh.boDemO.trim());
    },
    dangTrongO() {
      return doSauO > 0;
    },
    themVaoODangMo(vanBan) {
      if (!vanBan) return;
      const dinh = bangStack[bangStack.length - 1];
      if (dinh) dinh.boDemO += (dinh.boDemO ? " " : "") + vanBan;
    },
  };
}
