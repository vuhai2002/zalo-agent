/**
 * Chống giả mạo nhãn nguồn (I13) cho `kb-search-tool.ts`: một tài liệu (hoặc
 * chính TÊN NGUỒN/TIÊU ĐỀ của nó) có thể tự viết đúng định dạng `[Nguồn: ...]`
 * cùng dải phân cách `\n\n---\n\n` mà `dinhDangDoan` dùng để đánh dấu ranh
 * giới giữa các đoạn - nếu không khử, nội dung độc hại trong tài liệu A có
 * thể tự gán cho tài liệu B, và model dẫn sai nguồn cho người hỏi.
 *
 * ĐÃ QUA HAI VÒNG RÀ SOÁT. Vòng 2 sửa `tieuDe` không qua khử + regex hẹp
 * (ZWSP, fullwidth). Vòng 3 tìm tiếp:
 *
 *   - Bản vá vòng 2 tự làm regex HẸP HƠN bản gốc: lớp đệm `\s` chỉ còn ở SAU
 *     "Nguồn" (trước dấu `:`), MẤT ở NGAY SAU ngoặc mở - `[ Nguồn:` (một dấu
 *     cách ASCII, không cần ký tự lạ gì) LỌT dù bản GỐC (chỉ có `\[\s*Nguồn`)
 *     từng bắt được. Bài học: đổi regex bảo mật PHẢI so cả hai bản trên CÙNG
 *     một tập payload, phép phá chỉ chứng minh "cần cho test mới" chứ không
 *     chứng minh "bao trùm test cũ" - xem test superset ở file test.
 *   - `tieuDe`/`tenNguon` dù đã qua khử ngoặc (đổi 4 ký tự ngoặc) vẫn KHÔNG
 *     qua `locKyTuAn` (dải Tags trong tiêu đề lọt) lẫn không qua khử nhãn/dải
 *     phân cách như nội dung đoạn - cùng đường tấn công, phải cùng một hàng
 *     rào. Nay CẢ HAI qua ĐÚNG pipeline `noiDung` nhận (xem `kb-search-tool.ts`).
 *   - Thêm ba dạng ngoặc mở CJK/toán đo được: `【` `⁅` `﹇`.
 *   - `normalize("NFC")` trước khi khử: `[Nguồn:` viết dạng NFD (chữ "ồ" tách
 *     thành "o" + hai dấu tổ hợp) lọt vì regex so khớp CHUỖI CODEPOINT. NFC an
 *     toàn hơn NFKC nhiều: chỉ GHÉP LẠI tổ hợp CHUẨN TẮC, không đổi nghĩa hay
 *     hình dạng hiển thị (khác NFKC đã bị loại ở nghiên cứu Câu hỏi 1 vì đổi
 *     `½`->`1⁄2`, `ﬁ`->`fi`...).
 *
 * Module THUẦN: không env, không DB.
 */

/** Đệm GIỮA từng chữ cái "Nguồn" - ký tự định dạng vô hình + dấu phụ, KHÔNG
 * gồm `\s`: chữ cái không tự nhiên cách nhau bằng dấu cách hợp lệ. */
const DEM_GIUA = "[\\p{Cf}\\p{Mn}]*";

/** Đệm NGAY SAU ngoặc mở - PHẢI gồm `\s`: đây đúng chỗ vòng rà soát lần 3 bắt
 * được quên (bản trước chỉ đệm `\p{Cf}`/`\p{Mn}` ở đây, một dấu cách ASCII
 * thường (` `) không thuộc hai lớp đó nên lọt nguyên văn). */
const DEM_DAU = "[\\s\\p{Cf}\\p{Mn}]*";

/** Cặp ngoặc mở/đóng có thể giả làm hoặc tự đóng sớm nhãn `[Nguồn: ...]` -
 * ASCII, fullwidth, và ba biến thể CJK/toán đo được ở vòng rà soát. Thêm dạng
 * ngoặc mới thì chỉ sửa MẢNG này - cả regex nhãn lẫn bộ khử ngoặc dùng chung,
 * không lặp danh sách ở hai nơi rồi trôi khỏi nhau. */
const CAP_NGOAC: readonly [string, string][] = [
  ["[", "]"],
  ["［", "］"], // U+FF3B/FF3D fullwidth
  ["【", "】"], // U+3010/3011 CJK black lenticular bracket
  ["⁅", "⁆"], // U+2045/2046 square bracket with quill
  ["﹇", "﹈"], // U+FE47/FE48 presentation form for vertical left/right square bracket
];
const NGOAC_MO_SET = new Set(CAP_NGOAC.map(([mo]) => mo));

/** Dựng lớp ký tự regex an toàn từ danh sách - escape đúng MỘT ký tự cần:
 * ASCII `]` (đóng sớm lớp ký tự nếu không escape). Các dạng ngoặc khác không
 * phải meta-char của regex nên giữ nguyên. */
function lopKyTu(chars: readonly string[]): string {
  return `[${chars.map((c) => (c === "]" ? "\\]" : c)).join("")}]`;
}

const NHAN_NGUON_GIA_RE = new RegExp(
  `${lopKyTu(CAP_NGOAC.map(([mo]) => mo))}${DEM_DAU}${[..."Nguồn"].join(DEM_GIUA)}${DEM_GIUA}[\\s\\p{Cf}]*:`,
  "giu",
);

const NGOAC_CA_HAI_RE = new RegExp(lopKyTu(CAP_NGOAC.flat()), "g");

/** Mọi dạng ngoặc vuông trong TÊN NGUỒN/TIÊU ĐỀ (kể cả không kèm chữ "Nguồn")
 * tự đóng/mở được nhãn `[Nguồn: ...]` bao ngoài - đổi sang ngoặc tròn để giữ
 * chữ mà không giữ cấu trúc. Gọi SAU `khuGiaMaoTrongDoan`: đó lo đúng mẫu
 * "[Nguồn:", đây lo MỌI ngoặc còn sót có thể đóng sớm khối bao ngoài dù không
 * mang chữ "Nguồn" (vd tiêu đề "Sản phẩm] Giảm giá" không có "Nguồn" nhưng
 * dấu `]` vẫn đóng sớm được `[Nguồn: ...]` thật). */
export function khuNgoacVuongTrongNhan(s: string): string {
  return s.replace(NGOAC_CA_HAI_RE, (c) => (NGOAC_MO_SET.has(c) ? "(" : ")"));
}

/** Một DÒNG (không xuống dòng) toàn khoảng trắng/ký tự định dạng/ký tự phân
 * cách Unicode (`\p{Zs}`: NBSP, em space, ideographic space...) hoặc dấu cách
 * Braille (U+2800, không thuộc `\p{Zs}`) - ĐÚNG MỘT lượng từ trên MỘT lớp ký
 * tự, không lồng với gì khác. */
const DONG_TRONG_RE = /^[ \t\p{Cf}\p{Zs}⠀]*$/u;

/** Một DÒNG chỉ có gạch ngang (>=3), cho phép khoảng trắng/ký tự định dạng
 * hai đầu - HAI lượng từ TÁCH BIỆT trên các lớp ký tự RỜI NHAU (gạch ngang
 * không nằm trong lớp khoảng trắng), không lồng nhau nên không mơ hồ. */
const DONG_GACH_RE = /^[ \t\p{Cf}\p{Zs}⠀]*-{3,}[ \t\p{Cf}\p{Zs}⠀]*$/u;

/**
 * Gộp dải phân cách GIẢ (nhiều dòng trống bao quanh một dòng gạch ngang) về
 * đúng MỘT dòng trống mỗi bên - phá cấu trúc "2 dòng trống bao quanh" mà
 * `.join("\n\n---\n\n")` dùng để nối các đoạn thật.
 *
 * Viết bằng CODE (quét từng dòng, con trỏ chỉ tiến) thay vì nhồi vào MỘT
 * regex - bản vòng 2 dùng `(?:\n[ \t\p{Cf}]*){2,}(-{3,})(?:\n[ \t\p{Cf}]*){2,}`,
 * HAI lượng từ LỒNG NHAU (lượng từ trong `[...]*`, lượng từ ngoài `{2,}` quanh
 * cả nhóm chứa nó) - vòng rà soát đo được O(n^2) THẬT trên payload `("\n ")*n`:
 * 441ms cho 24.008 ký tự (gấp đôi độ dài -> gấp bốn thời gian), so với
 * 0,01-0,04ms của regex cũ tới tận 48.000 ký tự. Đúng lớp lỗi mà
 * `sanitize-reply-text.ts:24-33` đã ghi thành luật sống còn sau một lần trả
 * giá thật ("MỖI biểu thức chỉ có MỘT lượng từ mở trên cùng một lớp ký tự;
 * phần kiểm thêm làm bằng code, không bằng backtrack"). Bản này quét MỖI DÒNG
 * đúng một lần (hai con trỏ chỉ tiến, không lùi) nên tuyến tính theo số dòng -
 * xem test đo thời gian.
 */
function khuDaiPhanCachGia(s: string): string {
  if (!s.includes("-")) return s; // lối tắt rẻ - đa số nội dung không có gạch ngang chuỗi 3+
  const dong = s.split("\n");
  const ra: string[] = [];
  let i = 0;
  let doiChut = false;
  while (i < dong.length) {
    let j = i;
    while (j < dong.length && DONG_TRONG_RE.test(dong[j]!)) j++;
    const coTrongTruoc = j > i;

    if (coTrongTruoc && j < dong.length && DONG_GACH_RE.test(dong[j]!)) {
      let k = j + 1;
      while (k < dong.length && DONG_TRONG_RE.test(dong[k]!)) k++;
      if (k > j + 1) {
        // Đúng mẫu: >=1 dòng trống - dòng gạch ngang - >=1 dòng trống. GỘP VỀ
        // KHÔNG DÒNG TRỐNG NÀO CẢ (dòng gạch ngang dính liền chữ hai bên) -
        // không phải "còn lại đúng 1 dòng trống". Bug thật đã xảy ra ở đây:
        // bản đầu push "", dong[j], "" (giữ lại 1 dòng trống mỗi bên) - với
        // payload CHỈ CÓ ĐÚNG 1 dòng trống mỗi bên (chính là hình dạng "\n\n---
        // \n\n" mà `.join()` dùng), "gộp về 1" là PHÉP ĐỒNG NHẤT, không đổi gì
        // - dải phân cách giả sống sót y nguyên. Đúng ngữ nghĩa của regex CŨ
        // (`\n{2,}(-{3,})\n{2,}` thay bằng `\n${dashes}\n`): khớp tối thiểu 2
        // dấu xuống dòng mỗi bên (>=1 dòng trống) rồi thay bằng ĐÚNG 1 dấu
        // xuống dòng (0 dòng trống) - luôn CẮT MỘT NẤC, không giữ nguyên nấc.
        ra.push(dong[j]!);
        i = k;
        doiChut = true;
        continue;
      }
    }
    // Không khớp mẫu phân cách giả - giữ nguyên nhóm dòng trống (nếu có) rồi
    // dòng hiện tại, không đụng gì.
    for (let m = i; m < j; m++) ra.push(dong[m]!);
    if (j < dong.length) {
      ra.push(dong[j]!);
      i = j + 1;
    } else {
      i = j;
    }
  }
  return doiChut ? ra.join("\n") : s;
}

/**
 * Khử giả mạo trong MỘT chuỗi - dùng cho cả `noiDung` LẪN `tenNguon`/`tieuDe`
 * (cùng một pipeline, xem docstring đầu file).
 *
 * Export để test đo trực tiếp: (a) test siêu tập so regex mới với regex cũ
 * trên cùng một tập payload, (b) test hiệu năng tuyến tính - cả hai cần gọi
 * thẳng hàm này, đi qua nguyên cả tool (DB thật) sẽ làm nhiễu số đo thời gian.
 */
export function khuGiaMaoTrongDoan(s: string): string {
  return khuDaiPhanCachGia(s.normalize("NFC").replace(NHAN_NGUON_GIA_RE, "(Nguồn:"));
}
