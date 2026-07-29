/**
 * Chuyển một step của AI SDK thành bản ghi gọn để log và lưu DB.
 *
 * Vì sao cần: bản đầu chỉ log `toolResults`, nên khi bot làm sai thì không biết
 * model GỬI GÌ cho tool, nó nói gì giữa các step, hay provider có âm thầm bỏ
 * tham số nào không. Đã trả giá hai lần: vụ dò vé số phải đi đường vòng qua DB
 * và tái hiện tay, vụ `imageIndex` phải suy luận ngược từ câu lỗi.
 *
 * Module THUẦN: không đụng env, không đụng DB, nhận sẵn trần ký tự. Nhờ vậy test
 * chạy thẳng và phần cắt ngắn kiểm được độc lập với chuyện lưu trữ.
 *
 * Về `reasoning`: có hay không là do MODEL, không phải do code. Đo thật qua
 * router - DeepSeek trả nguyên chuỗi suy nghĩ kể cả khi không stream, còn
 * OpenAI (gpt-5.6-sol) chỉ trả một dòng nhãn tóm tắt lúc stream và không trả gì
 * khi không stream. `@ai-sdk/openai-compatible` đã tự map `reasoning_content`
 * thành reasoning part nên chỗ này chỉ việc đọc `reasoningText`.
 */

/**
 * Hình dạng tối thiểu mình cần từ StepResult. Tự khai thay vì import type của
 * SDK: giữ module thuần, và test dựng được step giả mà không cần cả bộ generic.
 */
export type RawStep = {
  stepNumber?: number;
  text?: string;
  reasoningText?: string;
  toolCalls?: { toolName?: string; input?: unknown }[];
  toolResults?: { toolName?: string; output?: unknown }[];
  /**
   * Các phần nội dung thô của step. Tool CHẠY LỖI nằm ở đây dạng
   * `type: "tool-error"` và KHÔNG BAO GIỜ lọt vào `toolResults` - getter đó chỉ
   * lọc `type === "tool-result"`. Đã đo thật với AI SDK 7.0.37: tool ném lỗi cho
   * ra `toolResults.length === 0` còn `content` có `tool-call, tool-error`.
   * Đọc thiếu chỗ này là mù toàn bộ lớp sự kiện tool thất bại.
   */
  content?: { type?: string; toolName?: string; error?: unknown }[];
  finishReason?: string;
  warnings?: unknown[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type StepTrace = {
  stepNumber: number;
  /**
   * Lần chạy thứ mấy TRONG CÙNG lượt. Lượt retry (router trả rỗng) hay lượt
   * dựng lại không kèm pixel đều đánh số step lại từ 1, nên trace của một lượt
   * có thể là 1,2,3 rồi 1,2,3 - xếp theo step_number đọc ra 1,1,2,2,3,3 và
   * trông y hệt model đang lặp vô hạn. Cột này phân biệt hai lần chạy.
   */
  attempt: number;
  text: string;
  reasoning: string;
  toolCalls: { name: string; input: string }[];
  toolResults: { name: string; output: string }[];
  /** Tool chạy lỗi: schema chặn input, tool ném exception, provider trả lỗi */
  toolErrors: { name: string; error: string }[];
  finishReason: string;
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
};

/**
 * Cắt kèm ĐỘ DÀI THẬT. Cắt lén bằng dấu ba chấm trơn thì đọc log không biết
 * mình đang mất 50 ký tự hay 50.000 - mà đó chính là thứ cần biết khi nghi ngờ
 * model nhận thiếu dữ liệu.
 */
function cat(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... (${value.length} ký tự)`;
}

/** JSON.stringify an toàn: input tool có thể chứa vòng lặp hoặc BigInt */
function thanhChuoi(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Ép lỗi về câu đọc được. KHÔNG dùng thẳng `thanhChuoi`: `message` và `stack`
 * của Error là non-enumerable nên `JSON.stringify(err)` ra `{}` - đúng thứ cần
 * đọc lại là thứ bị mất. Zod báo lỗi schema dạng mảng issue nên vẫn cần nhánh
 * JSON cho trường hợp không phải Error.
 */
function loiThanhChuoi(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  return thanhChuoi(err);
}

/** Warning của SDK là object đủ hình dạng - ép về câu người đọc được */
function warningThanhChuoi(w: unknown): string {
  if (typeof w === "string") return w;
  if (w && typeof w === "object") {
    const o = w as Record<string, unknown>;
    const phan = [o.type, o.setting, o.message, o.details].filter(Boolean).map(String);
    if (phan.length > 0) return phan.join(" - ");
  }
  return thanhChuoi(w);
}

export function summarizeStep(step: RawStep, maxChars: number, attempt = 1): StepTrace {
  return {
    attempt,
    // AI SDK đánh số từ 0; đổi sang đếm-từ-1 NGAY TẠI ĐÂY để log, DB và giao
    // diện cùng một con số. Đổi ở riêng giao diện thì đọc log lại lệch một đơn vị.
    stepNumber: (step.stepNumber ?? 0) + 1,
    text: cat(step.text ?? "", maxChars),
    reasoning: cat(step.reasoningText ?? "", maxChars),
    toolCalls: (step.toolCalls ?? []).map((c) => ({
      name: c.toolName ?? "?",
      input: cat(thanhChuoi(c.input), maxChars),
    })),
    toolResults: (step.toolResults ?? []).map((r) => ({
      name: r.toolName ?? "?",
      output: cat(thanhChuoi(r.output), maxChars),
    })),
    toolErrors: (step.content ?? [])
      .filter((p) => p.type === "tool-error")
      .map((p) => ({
        name: p.toolName ?? "?",
        error: cat(loiThanhChuoi(p.error), maxChars),
      })),
    finishReason: step.finishReason ?? "",
    // Warnings là chỗ provider báo tham số bị bỏ qua - đúng loại lỗi đã dính 2
    // lần (`size` bị model phớt lờ, `quality` không được gửi)
    warnings: (step.warnings ?? []).map(warningThanhChuoi),
    inputTokens: step.usage?.inputTokens ?? 0,
    outputTokens: step.usage?.outputTokens ?? 0,
  };
}
