import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  type ISectionOptions,
} from "docx";
import type { DocumentBlock } from "./document-content-schema.js";
import { parseTextRuns } from "./docx-text-runs.js";
import { DOCX_STYLES, PAGE_MARGINS } from "./render-docx-styles.js";
import { buildTable, buildTwoColumns } from "./render-docx-tables.js";

/**
 * Dựng file .docx từ nội dung model cung cấp.
 *
 * Mọi quy ước định dạng nằm ở ĐÂY chứ không ở prompt - nhờ vậy file luôn đẹp
 * như nhau kể cả khi chạy model rẻ tiền. Typography (Times New Roman, heading
 * đen, lề chuẩn) ở `render-docx-styles.ts`, phần bảng ở `render-docx-tables.ts`;
 * các gotcha cấu trúc lấy từ skill `docx` của Anthropic và đã kiểm chứng bằng
 * cách giải nén file đọc ngược XML.
 */

/** Tham chiếu numbering dùng chung cho mọi block bullets trong tài liệu */
const BULLET_REFERENCE = "bullet-list";

/**
 * Cấp tiêu đề -> HeadingLevel của docx.
 *
 * Là HÀM chứ không phải bảng tra, vì schema khai `level` là khoảng số (xem
 * `document-content-schema.ts` về lý do không dùng union literal) nên kiểu ở
 * đây là `number`, index thẳng vào bảng `as const` không biên dịch được. Viết
 * hàm có nhánh mặc định rõ ràng thay vì ép kiểu: nới khoảng ở schema về sau
 * thì chỗ này vẫn ra tiêu đề hợp lệ chứ không ra `undefined`.
 */
function headingCuaCap(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level <= 1) return HeadingLevel.HEADING_1;
  if (level >= 3) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_2;
}

const ALIGNMENT = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

/** Thụt đầu dòng 1cm cho đoạn văn thường - nếp trình bày văn bản Việt Nam */
const FIRST_LINE_INDENT = 567;

function blockToElements(block: DocumentBlock): (Paragraph | Table)[] {
  switch (block.type) {
    case "heading":
      // Dùng HeadingLevel built-in (đã restyle đen trong DOCX_STYLES) để mục
      // lục (TOC) nhận ra được nếu sau này cần
      return [new Paragraph({ text: block.text, heading: headingCuaCap(block.level) })];

    case "paragraph":
      // Model có thể nhét "\n" vào - tách thành nhiều Paragraph vì docx bỏ qua
      // ký tự xuống dòng, cả đoạn sẽ dính liền thành một dòng dài
      return block.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(
          (line) =>
            new Paragraph({
              children: parseTextRuns(line),
              alignment: ALIGNMENT[block.align ?? "justify"],
              // Thụt đầu dòng chỉ cho đoạn văn xuôi; dòng canh giữa/phải là
              // lạc khoản (địa danh, ngày tháng, ký tên) - thụt vào là lệch
              indent:
                (block.align ?? "justify") === "justify"
                  ? { firstLine: FIRST_LINE_INDENT }
                  : undefined,
            }),
        );

    case "bullets":
      // Không bao giờ chèn ký tự "•" thẳng vào text - phải qua numbering config,
      // nếu không Word không nhận ra đây là danh sách (không thụt lề, không nối tiếp)
      return block.items.map(
        (item) =>
          new Paragraph({
            children: parseTextRuns(item),
            numbering: { reference: BULLET_REFERENCE, level: 0 },
            spacing: { after: 60 },
          }),
      );

    case "table":
      // Paragraph rỗng sau bảng: 2 bảng liền nhau không có nó sẽ bị Word gộp làm một
      return [buildTable(block.headers, block.rows), new Paragraph({ text: "" })];

    case "two_columns":
      return [buildTwoColumns(block.left, block.right), new Paragraph({ text: "" })];
  }
}

export type DocxMeta = { title?: string };

export async function renderDocx(blocks: DocumentBlock[], meta: DocxMeta = {}): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  if (meta.title?.trim()) {
    children.push(new Paragraph({ text: meta.title.trim(), heading: HeadingLevel.TITLE }));
  }
  for (const block of blocks) {
    children.push(...blockToElements(block));
  }

  const section: ISectionOptions = {
    properties: { page: { margin: PAGE_MARGINS } },
    children,
  };

  const doc = new Document({
    styles: DOCX_STYLES,
    numbering: {
      config: [
        {
          reference: BULLET_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [section],
  });

  return Packer.toBuffer(doc);
}
