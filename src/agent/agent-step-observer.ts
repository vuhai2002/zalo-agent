import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { summarizeStep, type RawStep, type StepTrace } from "./agent-step-trace.js";
import { laKetQuaLoi } from "./tools/tool-failure-result.js";
import type { ToolLoopGuard } from "./tool-loop-guard.js";

const log = createLogger("agent-loop");

/**
 * Mọi việc phải làm SAU mỗi step của vòng lặp agent: đếm cho guard chống lặp,
 * ghi log tool đã chạy và tool chạy lỗi, gom trace.
 *
 * Tách khỏi `agent-loop.ts` vì đây là phần QUAN SÁT, không phải phần điều
 * khiển: nó không quyết định vòng lặp đi tiếp hay dừng (guard quyết, qua
 * `stopWhen`), chỉ đọc và ghi lại. Để lẫn trong `generateText` thì cái quyết
 * định và cái ghi chép nằm chồng lên nhau, và file đó đã dài gấp đôi ngưỡng.
 */

/** Cắt gọn giá trị cho log - output tool (nội dung trang web) dài hàng nghìn ký tự */
export function forLog(value: unknown, max: number): string {
  // `JSON.stringify(undefined)` trả về undefined chứ không phải chuỗi - đọc
  // `.length` của nó là TypeError. SDK có đặt `input: void 0` cho tool do
  // provider tự chạy.
  // Nhánh hỏng hiện CÂU thay vì vỏ JSON: vỏ vừa khó đọc vừa ăn mất ~20 ký tự
  // trong trần 300, mà phần bị cắt lại chính là phần nói vì sao hỏng.
  const text = laKetQuaLoi(value)
    ? `LỖI: ${value.loi}`
    : typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Các field NGẮN nhưng quyết định hành vi, tách ra log riêng để không bị cắt
 * mất sau field dài. Đã dính thật: `prompt` của create_image dài hơn trần 200
 * ký tự nên `imageIndex` đứng sau bị nuốt sạch - chẩn đoán phải suy luận ngược
 * từ câu lỗi thay vì đọc thẳng.
 */
const SHORT_FIELDS = ["mode", "imageIndex", "transparentBackground", "fileName"];

function shortArgsOf(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of SHORT_FIELDS) {
    if (record[key] !== undefined) picked[key] = record[key];
  }
  // Độ dài prompt phân biệt được "model chép nguyên văn nội dung người dùng đưa"
  // với "model tóm tắt thành chủ đề" - hai thứ cho ra ảnh khác hẳn nhau mà nhìn
  // 200 ký tự đầu thì không tài nào biết được
  if (typeof record.prompt === "string") picked.promptChars = record.prompt.length;
  return Object.keys(picked).length > 0 ? picked : undefined;
}

/**
 * Hình dạng tối thiểu của step mà hàm này đọc - khai theo cấu trúc, không import
 * type SDK.
 *
 * Dùng LẠI `RawStep` thay vì khai một hình dạng thứ hai gần giống. Bản đầu khai
 * riêng nên nó thiếu 7 trường mà `summarizeStep` có đọc (`stepNumber`, `text`,
 * `usage`...), và chỗ gọi phải cast `step as never` để TypeScript im - tức là
 * tắt đúng cái kiểm tra sẽ báo khi hai hình dạng lệch nhau thêm nữa.
 */
type StepDaChay = RawStep;

/**
 * Dựng handler cho `onStepFinish`.
 *
 * @param layLanChay đọc LÚC GỌI chứ không nhận số: lần chạy tăng lên giữa lượt
 *   (retry glitch router, dựng lại không kèm pixel), truyền số là trace của các
 *   lần sau bị đánh nhãn của lần đầu và đọc ra như model đang lặp vô hạn.
 */
export function taoQuanSatStep(input: {
  guard: ToolLoopGuard;
  trace: StepTrace[];
  layLanChay: () => number;
}) {
  const { guard, trace, layLanChay } = input;

  // Tự bắt lỗi thay vì để SDK bắt. `notify()` của ai@7.0.37 gọi callback trong
  // `try {...} catch (e) {}` RỖNG, nên một lỗi ở đây không đỏ lên ở đâu cả:
  // guard ngừng đếm, trace ngừng ghi, mà log thì sạch bong. Bọc lấy để ít nhất
  // còn một dòng ERROR nói rằng phần quan sát đã chết từ step nào.
  return (step: StepDaChay): void => {
    try {
      quanSat(step);
    } catch (err) {
      log.error({ err }, "Quan sát step lỗi - guard và trace mất dữ liệu của step này");
    }
  };

  function quanSat(step: StepDaChay): void {
    // Ghi nhận TRƯỚC phần log tool bên dưới: quyết định chặn phải có mặt trong
    // cùng cụm log với chính step gây ra nó, không phải mãi step sau.
    const qd = guard.ghiNhan(step);
    if (qd.muc === "chan") {
      log.error(
        { tool: qd.tool, soLan: qd.soLan, ma: qd.ma },
        `Chặn vòng lặp tool: ${qd.thongDiep} Dừng lượt và chốt lại bằng dữ liệu đã có.`,
      );
    } else if (qd.muc === "canh-bao") {
      log.warn({ tool: qd.tool, soLan: qd.soLan, ma: qd.ma }, qd.thongDiep);
    }

    for (const r of step.toolResults ?? []) {
      log.info(
        {
          tool: r.toolName,
          input: forLog(r.input, 200),
          // Đứng SAU input trong object nhưng là field riêng nên không bị trần
          // 200 ký tự của input nuốt mất
          args: shortArgsOf(r.input),
          output: forLog(r.output, 300),
        },
        "Tool đã chạy",
      );
    }

    // Tool CHẠY LỖI không bao giờ lọt vào `toolResults` - getter đó chỉ lọc
    // `type === "tool-result"`. Đo thật với ai@7.0.37: tool ném exception cho ra
    // toolResults rỗng, lỗi nằm ở `content` dạng `tool-error`. Trước khi có vòng
    // này, schema chặn input hay tool ném lỗi đều không để lại dấu vết nào: log
    // trống, trace hiện "Gọi tool" rồi cụt, còn model thì vẫn nhận lỗi và thử
    // lại vài vòng - nhìn từ ngoài chỉ thấy bot hứa rồi không làm được. Mức
    // ERROR vì đây là việc đã HỎNG, không phải chẩn đoán.
    for (const p of step.content ?? []) {
      if (p.type !== "tool-error") continue;
      log.error(
        {
          tool: p.toolName,
          args: shortArgsOf(p.input),
          error: forLog(p.error instanceof Error ? p.error.message : p.error, 300),
        },
        "Tool chạy lỗi",
      );
    }

    if (!getTuning("AGENT_TRACE_ENABLED")) return;
    const t = summarizeStep(step, getTuning("AGENT_TRACE_MAX_CHARS"), layLanChay());
    trace.push(t);
    // Mức DEBUG vì đây là dữ liệu chẩn đoán, bật khi cần chứ không đổ vào log
    // thường. Ghi cả TOOL CALL (model gửi gì) chứ không chỉ kết quả, và cả
    // warnings - chỗ provider báo tham số bị âm thầm bỏ qua.
    log.debug(
      {
        step: t.stepNumber,
        attempt: t.attempt,
        finishReason: t.finishReason,
        text: t.text,
        // Rỗng với model OpenAI (không phơi chuỗi suy nghĩ), có nội dung với
        // DeepSeek - phụ thuộc MODEL chứ không phải cấu hình
        reasoning: t.reasoning,
        toolCalls: t.toolCalls,
        toolResults: t.toolResults,
        toolErrors: t.toolErrors,
        warnings: t.warnings,
        tokens: { in: t.inputTokens, out: t.outputTokens },
      },
      "Chi tiết step agent",
    );
  }
}
