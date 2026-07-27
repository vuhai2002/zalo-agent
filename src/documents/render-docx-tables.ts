import {
  AlignmentType,
  BorderStyle,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from "docx";
import { parseTextRuns } from "./docx-text-runs.js";
import { CONTENT_WIDTH_DXA, TABLE_CELL_MARGINS } from "./render-docx-styles.js";

/** Phần dựng bảng của renderer .docx - tách khỏi render-docx.ts cho gọn */

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const HIDDEN_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
} as const;

/** Chia đều bề rộng cho N cột, dồn phần dư vào cột cuối để tổng khớp tuyệt đối */
export function columnWidths(count: number, total = CONTENT_WIDTH_DXA): number[] {
  const each = Math.floor(total / count);
  const widths = Array.from({ length: count }, () => each);
  widths[count - 1] = total - each * (count - 1);
  return widths;
}

function buildCell(text: string, width: number, isHeader: boolean): TableCell {
  return new TableCell({
    // Bảng cần DUAL WIDTH: cả table lẫn từng cell, đều DXA.
    // PERCENTAGE trông vẫn ổn trong Word nhưng vỡ khi mở bằng Google Docs.
    width: { size: width, type: WidthType.DXA },
    // CLEAR chứ không SOLID - SOLID render ra nền đen đặc
    shading: isHeader ? { type: ShadingType.CLEAR, fill: "F1F5F9" } : undefined,
    children: [
      new Paragraph({
        children: parseTextRuns(text, { bold: isHeader }),
        spacing: { after: 0 },
      }),
    ],
  });
}

export function buildTable(headers: string[], rows: string[][]): Table {
  const widths = columnWidths(headers.length);
  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    // Đệm trong ô - thiếu là chữ dính sát viền
    margins: TABLE_CELL_MARGINS,
    rows: [
      new TableRow({
        children: headers.map((h, i) => buildCell(h, widths[i]!, true)),
        tableHeader: true, // lặp lại header khi bảng tràn sang trang sau
      }),
      ...rows.map(
        (row) =>
          new TableRow({ children: row.map((cell, i) => buildCell(cell, widths[i]!, false)) }),
      ),
    ],
  });
}

/**
 * Hai cột không viền cạnh nhau - phần đầu văn bản hành chính (cơ quan | quốc
 * hiệu) và khối ký tên (nơi nhận | chức vụ + tên). Mỗi dòng canh giữa trong
 * cột của nó, đậm qua marker ** do model tự đặt.
 */
export function buildTwoColumns(left: string[], right: string[]): Table {
  const widths = columnWidths(2);
  const cell = (lines: string[], width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      children: lines.map(
        (line) =>
          new Paragraph({
            children: parseTextRuns(line),
            alignment: AlignmentType.CENTER,
            spacing: { after: 0 },
          }),
      ),
    });
  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    borders: HIDDEN_BORDERS,
    margins: TABLE_CELL_MARGINS,
    rows: [new TableRow({ children: [cell(left, widths[0]!), cell(right, widths[1]!)] })],
  });
}
