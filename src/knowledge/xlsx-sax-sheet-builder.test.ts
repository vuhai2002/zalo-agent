import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SaxesTagNS } from "saxes";
// Module thuần (chỉ tính toán, không chạm env/DB) - import tĩnh an toàn, xem
// "Bẫy khi viết test" trong CLAUDE.md.
import { taoXlsxSheetSaxBuilder, type NganSachO } from "./xlsx-sax-sheet-builder.js";

const SPREADSHEETML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/**
 * PRNG nhỏ (mulberry32), SEED CỐ ĐỊNH - fuzz phải lặp lại Y HỆT mỗi lần
 * chạy, không được nhấp nháy theo `Math.random()` trần (test flake là tệ
 * hơn không có test, theo đúng yêu cầu review vòng này).
 */
function taoPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cột số (1-based) -> chữ Excel ("A", "AA", "XFD"...) - chiều NGƯỢC với
 * `chuCotThanhChiSo` nội bộ của module đang test, để nhồi vào thuộc tính r=. */
function soThanhChuCot(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function taoTag(local: string, r: string | undefined, tuDong: boolean): SaxesTagNS {
  const attributes: Record<string, { local: string; value: string }> = {};
  if (r !== undefined) attributes.r = { local: "r", value: r };
  // Ép kiểu CÓ CHỦ ĐÍCH: SaxesTagNS thật còn nhiều trường (prefix, ns...) mà
  // chiSoCotCua()/moThe()/dongThe() không hề đọc tới - dựng đủ 3 trường được
  // dùng thật (uri, local, attributes, isSelfClosing) rẻ hơn giả toàn bộ type.
  return { uri: SPREADSHEETML_NS, local, attributes, isSelfClosing: tuDong } as unknown as SaxesTagNS;
}

describe("xlsx-sax-sheet-builder - fuzz BẤT BIẾN (không chốt một chuỗi input)", () => {
  it("150 lượt, cột ngẫu nhiên 1..16.384, 20% ô không r=, toàn ô tự đóng - tongO luôn >= tổng push mảng THẬT", () => {
    // BẤT BIẾN cần giữ (không phụ thuộc hình dạng input CỤ THỂ nào): "không
    // có cách sắp cột nào trong một hàng khiến themOVaoDong() chạy push()
    // thật mà nganSachO.tongO không ghi đủ công đó". Patch Array.prototype.push
    // để đếm THẬT (không suy luận qua chỉ số cột) - bắt được đúng lớp bug
    // "hoàn quỹ ÂM" bất kể input rơi vào hình dạng nào, không chỉ hình dạng
    // B (XFD1 rồi A1) đã biết trước.
    //
    // Toàn bộ ô đều TỰ ĐÓNG với giá trị rỗng (không gọi tới t="s"/<v> nào) -
    // cố ý: `dongHienTai.some(o => o.trim())` luôn false nên `cacDong.push()`
    // (ở nhánh đóng <row>) KHÔNG BAO GIỜ chạy - nếu để lẫn, push() đó sẽ cộng
    // vào bộ đếm toàn cục mà `tongO` không hề tính, làm sai lệch phép đo
    // (không phải bug của code, mà là nhiễu của cách đo).
    const SO_LUOT = 150;
    const SEED = 260809;
    const rand = taoPrng(SEED);

    let soPushThat = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- patch
    // TẠM THỜI một phương thức generic của prototype built-in để đếm lời gọi
    // thật - không có cách định kiểu chặt cho việc này; khôi phục ở finally
    // bất kể pass/fail, phạm vi chỉ trong đúng một test này.
    const arrProto = Array.prototype as any;
    const pushGoc: (...items: unknown[]) => number = arrProto.push;
    arrProto.push = function (this: unknown[], ...items: unknown[]): number {
      soPushThat += items.length;
      return pushGoc.apply(this, items);
    };

    try {
      for (let luot = 0; luot < SO_LUOT; luot++) {
        soPushThat = 0;
        const nganSachO: NganSachO = { tongO: 0 };
        const b = taoXlsxSheetSaxBuilder([], nganSachO);
        const soHang = 1 + Math.floor(rand() * 5);
        for (let h = 0; h < soHang; h++) {
          b.moThe!(taoTag("row", undefined, false));
          const soO = 1 + Math.floor(rand() * 8);
          for (let o = 0; o < soO; o++) {
            const coR = rand() >= 0.2; // 20% ô không r= - thừa kế cotKyVong
            const cot = 1 + Math.floor(rand() * 16384); // đúng biên 1..XFD
            const tag = taoTag("c", coR ? `${soThanhChuCot(cot)}1` : undefined, true);
            b.moThe!(tag);
            b.dongThe!(tag);
          }
          b.dongThe!(taoTag("row", undefined, false));
        }
        assert.ok(
          soPushThat <= nganSachO.tongO,
          `lượt ${luot} (seed ${SEED}): soPush thật=${soPushThat} > tongO=${nganSachO.tongO} - hoàn quỹ ÂM lọt qua`,
        );
      }
    } finally {
      arrProto.push = pushGoc;
    }
  });
});
