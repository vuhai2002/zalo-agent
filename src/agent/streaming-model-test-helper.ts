import { convertArrayToReadableStream, type MockLanguageModelV4 } from "ai/test";

/**
 * Đổi một kết quả kiểu `doGenerate` thành kết quả kiểu `doStream`.
 *
 * Vì sao cần: vòng lặp agent đi đường `streamText` (lý do ở
 * `stream-text-result.ts`), nên model giả phải cài `doStream` - `doGenerate`
 * không bao giờ được gọi tới nữa. Nhưng fixture của các test (`traLoi`,
 * `goiTool`, `rong`) mô tả MỘT LẦN TRẢ LỜI của model, và đó vẫn là cách gọn
 * nhất để đọc test. Nên giữ nguyên fixture, dựng cầu ở đây.
 *
 * Kiểu suy từ chính `MockLanguageModelV4`, KHÔNG import `@ai-sdk/provider`:
 * pnpm layout chặt nên package đó không phải dependency trực tiếp, import vào
 * là typecheck đỏ. Cùng lý do đã ghi ở `run-agent-turn.test.ts`.
 *
 * File này chỉ test dùng - đã loại khỏi `tsconfig.build.json`.
 */

export type KetQuaGenerate = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type KetQuaStream = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type PhanStream = KetQuaStream["stream"] extends ReadableStream<infer P> ? P : never;

/**
 * Phát lại đúng trình tự mà provider thật phát:
 * `stream-start` -> từng khối nội dung -> `finish`.
 *
 * Text và tool call phải phát KÈM cặp mở/đóng (`text-start`/`text-end`,
 * `tool-input-start`/`tool-input-end`) chứ không phát trần một khối: đó là
 * giao thức mà bộ gom của SDK bám vào để biết khối nào đã trọn.
 */
export function thanhKetQuaStream(ketQua: KetQuaGenerate): KetQuaStream {
  const phan: PhanStream[] = [{ type: "stream-start", warnings: ketQua.warnings ?? [] }];

  let dem = 0;
  for (const khoi of ketQua.content) {
    if (khoi.type === "text") {
      const id = `text-${++dem}`;
      phan.push({ type: "text-start", id });
      phan.push({ type: "text-delta", id, delta: khoi.text });
      phan.push({ type: "text-end", id });
      continue;
    }
    if (khoi.type === "tool-call") {
      phan.push({ type: "tool-input-start", id: khoi.toolCallId, toolName: khoi.toolName });
      phan.push({ type: "tool-input-delta", id: khoi.toolCallId, delta: khoi.input });
      phan.push({ type: "tool-input-end", id: khoi.toolCallId });
      phan.push(khoi);
      continue;
    }
    // reasoning, file, source... đi thẳng: chúng vừa là khối nội dung vừa là
    // phần stream hợp lệ, không có cặp mở/đóng nào phải dựng thêm.
    phan.push(khoi as PhanStream);
  }

  phan.push({ type: "finish", finishReason: ketQua.finishReason, usage: ketQua.usage });
  return { stream: convertArrayToReadableStream(phan) };
}
