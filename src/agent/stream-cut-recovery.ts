import { InvalidResponseDataError, type LanguageModelResponseMetadata, type LanguageModelUsage } from "ai";

/**
 * Hai ca stream bị cắt mà AI SDK từ ai@7.0.130 / @ai-sdk/openai-compatible@3.0.33
 * đổi cách báo, cùng đường cứu cho từng ca. Module THUẦN: không log, không env.
 *
 * Trước hai bản đó cả hai ca đều RESOLVE và vòng lặp tự xử lý; sau hai bản đó
 * cả hai đều NÉM - không có test nào đỏ vì test giả không dựng ra được hai ca
 * này, nên đổi hành vi xảy ra hoàn toàn câm. Probe trên cả hai bản đã đo:
 *   - hết `totalMs` ở step 2 sau khi step 1 gọi tool xong: bản cũ resolve
 *     `steps=1` rồi đi vào lượt chốt; bản mới reject `TimeoutError`, `onError`
 *     KHÔNG được gọi.
 *   - stream chỉ có `[DONE]`: bản cũ resolve rỗng 0 token (nhánh "router trả
 *     completion rỗng, thử lại 1 lần"); bản mới ném `InvalidResponseDataError`.
 */

/**
 * Lỗi do chính trần `timeout.totalMs` bắn. `totalMs` dựng bằng
 * `AbortSignal.timeout`, nên lý do hủy là `DOMException` tên `TimeoutError`.
 */
export function laLoiHetGio(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Stream đóng mà chưa từng có `finish_reason` - chữ ký mới của đúng ca glitch
 * "200 rỗng" của 9Router (router chuyển tiếp nguyên chunk của upstream, không
 * tự thêm chunk finish).
 *
 * So chữ ở đây là so câu của CHÍNH SDK (`openai-compatible` dist, "Response
 * stream ended without a finish reason."), không phải nội dung của người lạ -
 * không có ai soạn được chuỗi này để lách. Chỉ khớp lớp lỗi là chưa đủ:
 * `InvalidResponseDataError` còn bắn cho "choice == null" và vài ca khác, mà
 * những ca đó không chắc là vô hại để chạy lại.
 */
export function laStreamThieuFinish(err: unknown): boolean {
  return InvalidResponseDataError.isInstance(err) && /without a finish reason/i.test(err.message);
}

function cong(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

function congUsage(cacStep: { usage: LanguageModelUsage }[]): LanguageModelUsage {
  const tong = cacStep.reduce<LanguageModelUsage>(
    (acc, s) => ({
      ...acc,
      inputTokens: cong(acc.inputTokens, s.usage.inputTokens),
      outputTokens: cong(acc.outputTokens, s.usage.outputTokens),
      totalTokens: cong(acc.totalTokens, s.usage.totalTokens),
    }),
    { ...cacStep[0]!.usage, inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
  );
  // Chỉ còn đọc `cacheReadTokens` ở log cuối lượt - cộng đúng trường đó, các
  // trường chi tiết khác giữ theo step đầu chứ không bịa số.
  const cache = cacStep.reduce<number | undefined>(
    (acc, s) => cong(acc, s.usage.inputTokenDetails?.cacheReadTokens),
    undefined,
  );
  return { ...tong, inputTokenDetails: { ...tong.inputTokenDetails, cacheReadTokens: cache } };
}

/**
 * Dựng lại hình dạng kết quả của `gomKetQuaStream` từ các step ĐÃ XONG trước
 * khi lượt hết giờ - đúng thứ bản SDK cũ tự trả, để vòng lặp đi tiếp vào lượt
 * chốt (`canLuotChot`) như trước thay vì báo lỗi kỹ thuật và vứt bỏ kết quả
 * tool đã thu được.
 *
 * `response.messages` của MỖI step chỉ chứa tin của riêng step đó, KHÔNG cộng
 * dồn (đo trong test: 3 step ra `assistant+tool`, `assistant+tool`,
 * `assistant`). Nên phải NỐI tin của mọi step theo thứ tự - lấy riêng step
 * cuối là lượt chốt mất kết quả tool của mọi step trước, đúng thứ nó cần nhất.
 */
export function ketQuaTuStepDaXong<
  S extends { text: string; usage: LanguageModelUsage; response: LanguageModelResponseMetadata },
>(cacStep: S[]): { text: string; steps: S[]; totalUsage: LanguageModelUsage; finishReason: "other"; response: S["response"] } {
  const cuoi = cacStep.at(-1);
  if (!cuoi) throw new Error("ketQuaTuStepDaXong cần ít nhất một step đã xong");
  return {
    text: cuoi.text,
    steps: cacStep,
    totalUsage: congUsage(cacStep),
    finishReason: "other" as const,
    response: { ...cuoi.response, messages: cacStep.flatMap((s) => s.response.messages) },
  };
}
