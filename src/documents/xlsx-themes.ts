/**
 * Bộ màu cho file .xlsx - model CHỌN theo ngữ cảnh tài liệu, không tự do hex.
 *
 * Vì sao không cứng 1 màu: 10 báo cáo ra 10 file giống hệt nhau thì nhìn như
 * máy in hàng loạt. Vì sao không cho model tự chọn hex: nó sẽ ra những cặp màu
 * chữ trắng trên nền sáng không đọc nổi.
 *
 * Mọi màu nền dưới đây đã tính contrast với chữ TRẮNG theo công thức WCAG 2.1
 * và đều đạt mức AA cho chữ thường (>= 4.5:1) - số đo ghi kèm từng theme.
 * Cam sáng (ED7D31, 2.77:1) và vàng (FFC000, 1.64:1) bị loại vì trượt.
 */

export type XlsxTheme = {
  /** Nền banner tiêu đề + header bảng (chữ trắng đè lên) */
  readonly header: string;
  /** Màu chữ cho số liệu nhập tay - đậm cùng tông, không chói như xanh thuần */
  readonly number: string;
  /** Viền ô - nhạt cùng tông để bảng không bị khô */
  readonly border: string;
  /** Nền sọc xen kẽ cho dòng chẵn, rất nhạt */
  readonly stripe: string;
};

export const XLSX_THEMES = {
  /** 11.62:1 - trang trọng, mặc định cho báo cáo tổng hợp */
  navy: { header: "FF1F3864", number: "FF1F3864", border: "FF8496B0", stripe: "FFF2F5FA" },
  /** 8.66:1 - tài chính, kinh doanh, báo giá */
  blue: { header: "FF1F4E79", number: "FF1F4E79", border: "FF8EAADB", stripe: "FFF2F7FC" },
  /** 6.52:1 - tăng trưởng, nông nghiệp, môi trường, kết quả tốt */
  green: { header: "FF1E6B3A", number: "FF1E6B3A", border: "FF8FBC9B", stripe: "FFF1F8F3" },
  /** 8.65:1 - cảnh báo, rủi ro, pháp lý, sự cố */
  burgundy: { header: "FF8B2635", number: "FF8B2635", border: "FFD4A0A8", stripe: "FFFCF3F4" },
  /** 7.71:1 - kỹ thuật, vận hành, trung tính */
  slate: { header: "FF44546A", number: "FF44546A", border: "FFAEB8C6", stripe: "FFF4F6F8" },
  /** 6.84:1 - y tế, giáo dục, dịch vụ */
  teal: { header: "FF17646B", number: "FF17646B", border: "FF8FC0C4", stripe: "FFF0F8F8" },
} as const satisfies Record<string, XlsxTheme>;

export type XlsxThemeName = keyof typeof XLSX_THEMES;

export const XLSX_THEME_NAMES = Object.keys(XLSX_THEMES) as [XlsxThemeName, ...XlsxThemeName[]];

export const DEFAULT_XLSX_THEME: XlsxThemeName = "navy";

export function resolveTheme(name: XlsxThemeName | undefined): XlsxTheme {
  return XLSX_THEMES[name ?? DEFAULT_XLSX_THEME];
}
