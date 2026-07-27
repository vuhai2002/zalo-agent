import type { IStylesOptions } from "docx";

/**
 * Typography chuẩn văn bản tiếng Việt (theo nếp Nghị định 30/2020/NĐ-CP về văn
 * bản hành chính - cũng là kiểu người Việt coi là "tài liệu nghiêm túc"):
 * Times New Roman 13pt đen toàn văn bản, KHÔNG dùng theme mặc định của Word
 * (Calibri + heading xanh - nhìn là biết máy sinh, và lạc hẳn khỏi văn bản VN).
 *
 * Đây là phần "know-how nằm trong renderer": model không quyết được font/màu,
 * nên file luôn ra cùng một chất lượng bất kể chạy model nào.
 */

/** Đơn vị half-point: 26 = 13pt (cỡ chữ chuẩn văn bản hành chính) */
const BODY_SIZE = 26;
const FONT = "Times New Roman";
const BLACK = "000000";

export const DOCX_STYLES: IStylesOptions = {
  default: {
    document: {
      run: { font: FONT, size: BODY_SIZE, color: BLACK },
      paragraph: {
        // Giãn dòng ~1.3 (lineRule auto: 240 = 1 dòng), giãn đoạn 6pt - hết
        // cảnh "tường chữ" dính nhau
        spacing: { line: 312, after: 120 },
      },
    },
    title: {
      run: { font: FONT, size: 30, bold: true, color: BLACK },
      paragraph: {
        alignment: "center",
        spacing: { before: 120, after: 240 },
      },
    },
    heading1: {
      run: { font: FONT, size: 28, bold: true, color: BLACK },
      paragraph: { spacing: { before: 240, after: 120 } },
    },
    heading2: {
      run: { font: FONT, size: BODY_SIZE, bold: true, color: BLACK },
      paragraph: { spacing: { before: 200, after: 120 } },
    },
    heading3: {
      run: { font: FONT, size: BODY_SIZE, bold: true, italics: true, color: BLACK },
      paragraph: { spacing: { before: 160, after: 100 } },
    },
    // Renderer không phát heading 4-6 nhưng style mặc định của chúng vẫn nằm
    // trong file với MÀU XANH theme - ai mở file rồi tự áp Heading 4 sẽ dính.
    // Đen hóa luôn cho tài liệu thuần một tông.
    heading4: { run: { font: FONT, size: BODY_SIZE, bold: true, color: BLACK } },
    heading5: { run: { font: FONT, size: BODY_SIZE, bold: true, color: BLACK } },
    heading6: { run: { font: FONT, size: BODY_SIZE, bold: true, color: BLACK } },
  },
};

/**
 * Lề trang chuẩn văn bản hành chính (NĐ 30): trên/dưới 2cm, trái 3cm (chừa
 * đóng gáy), phải 1.5cm. Đơn vị twips (1cm = 567).
 */
export const PAGE_MARGINS = { top: 1134, bottom: 1134, left: 1701, right: 850 };

/** Bề rộng vùng nội dung = khổ A4 (11906) trừ 2 lề - bảng phải khớp số này */
export const CONTENT_WIDTH_DXA = 11906 - PAGE_MARGINS.left - PAGE_MARGINS.right;

/** Đệm trong ô bảng - thiếu nó chữ dính sát viền, nhìn ngộp */
export const TABLE_CELL_MARGINS = { top: 60, bottom: 60, left: 108, right: 108 };
