import { TextRun } from "docx";

/**
 * Chuyển text có đánh dấu `**đậm**` thành danh sách TextRun.
 *
 * Vì sao cần: văn bản thật cần đậm GIỮA dòng ("**Thời gian:** từ 7h00...",
 * "**Độc lập - Tự do - Hạnh phúc**") mà schema block thì cả block cùng một
 * kiểu chữ. Cho model dùng đúng ký hiệu markdown nó đã quen là rẻ nhất -
 * không thêm field schema, không thêm loại block.
 *
 * Chỉ hỗ trợ `**...**`. Không italic, không link - thêm khi có nhu cầu thật.
 */
export function parseTextRuns(text: string, base: { bold?: boolean } = {}): TextRun[] {
  const runs: TextRun[] = [];
  // Tách "trước **đậm** sau" thành ["trước ", "đậm", " sau"] - phần tử lẻ là đậm
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  parts.forEach((part, index) => {
    if (!part) return;
    runs.push(new TextRun({ text: part, bold: base.bold || index % 2 === 1 }));
  });
  // Text rỗng hoặc toàn dấu ** -> vẫn phải có 1 run để Paragraph hợp lệ
  return runs.length > 0 ? runs : [new TextRun({ text: "", bold: base.bold })];
}
