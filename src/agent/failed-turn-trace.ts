import type { StepTrace } from "./agent-step-trace.js";

/**
 * Dựng một bản ghi trace TỔNG HỢP cho lượt hỏng trước khi chạy được step nào.
 *
 * Vì sao cần: `getRecentTurnsAllThreads` cố ý dùng INNER JOIN sang `agent_steps`
 * để lượt không có trace không lên danh sách (bấm vào sẽ rỗng - có test canh).
 * Nhưng lượt chết ngay lần gọi đầu (sai API key, router 404, chưa cấu hình) thì
 * KHÔNG có step nào, nên nó biến mất hẳn khỏi trang Trace - đúng ca hỏng phổ
 * biến nhất của bản cài mới. Tệ hơn, drawer Sessions dùng `getRecentTurns`
 * (không JOIN) nên vẫn hiện lượt đó: hai màn hình cùng tên báo hai sự thật.
 *
 * Cách chữa đúng KHÔNG phải là đổi INNER thành LEFT (làm vậy chỉ đổi "biến mất"
 * thành "bấm vào rỗng"), mà là cho lượt hỏng CÓ trace thật để đọc.
 *
 * Cũng dùng cho hai ca không-ném khác mà trước đây chỉ để lại một dòng log:
 * guard chặn vòng lặp, và câu trả lời bị chặn vì rò system prompt.
 *
 * Module THUẦN: chỉ import type.
 */

export type LyDoLuotHong =
  | { loai: "loi-provider"; loai_loi: string; thongDiep: string }
  | { loai: "guard-chan"; ma: string; thongDiep: string }
  | { loai: "chan-ro-prompt" };

const MO_TA: Record<string, string> = {
  "loi-provider": "Lượt dừng vì lỗi từ nhà cung cấp",
  "guard-chan": "Lượt dừng vì bộ chặn vòng lặp công cụ",
  "chan-ro-prompt": "Câu trả lời bị chặn vì lộ chỉ dẫn nội bộ - KHÔNG gửi cho người dùng",
};

/**
 * `finishReason` mang mã máy đọc được (`error:auth`, `blocked:guard`...) vì
 * `TraceStepCard` đã hiện trường này thành chip sẵn - không phải sửa UI.
 */
export function traceLuotHong(lyDo: LyDoLuotHong, attempt = 1): StepTrace {
  const chung = {
    stepNumber: 0,
    attempt,
    reasoning: "",
    toolCalls: [],
    toolResults: [],
    toolErrors: [],
    warnings: [],
    inputTokens: 0,
    outputTokens: 0,
  };

  if (lyDo.loai === "loi-provider") {
    return {
      ...chung,
      text: `${MO_TA["loi-provider"]} (${lyDo.loai_loi}): ${lyDo.thongDiep}`,
      finishReason: `error:${lyDo.loai_loi}`,
    };
  }
  if (lyDo.loai === "guard-chan") {
    return {
      ...chung,
      text: `${MO_TA["guard-chan"]}: ${lyDo.thongDiep}`,
      finishReason: `blocked:${lyDo.ma}`,
    };
  }
  return { ...chung, text: MO_TA["chan-ro-prompt"]!, finishReason: "blocked:prompt-leak" };
}
