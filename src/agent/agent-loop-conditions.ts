/**
 * Các vị từ THUẦN quyết định vòng lặp agent dừng lúc nào và lượt kết thúc ra sao.
 *
 * Tách khỏi `agent-loop.ts` vì đây là phần duy nhất trong vòng lặp test được mà
 * không cần model, không cần DB, không cần mạng - gom lại một chỗ thì đọc ra
 * ngay đâu là logic thuần, đâu là phần phải chạy thật.
 *
 * KHÔNG phải để đưa `agent-loop.ts` xuống dưới 200 dòng: file đó vẫn dài gấp nhiều lần ngưỡng
 * (gấp hơn 2 lần ngưỡng). Phần còn lại của nó là một vòng lặp liền mạch với các
 * nhánh chịu lỗi đan vào nhau, cắt tiếp chỉ làm khó đọc hơn.
 *
 * `agent-loop.ts` re-export lại để mọi nơi import như cũ.
 */

/**
 * Chữ ký "router trả completion rỗng": 9Router thỉnh thoảng trả HTTP 200 với
 * message trống trơn - không text, không tool call, usage = 0. SDK coi đó là
 * thành công nên maxRetries không cứu. Phân biệt được với lượt "chỉ thả
 * reaction" hợp lệ: lượt đó CÓ tool call và CÓ token.
 */
export function isEmptyRouterCompletion(input: {
  text: string;
  toolCallCount: number;
  totalTokens: number;
}): boolean {
  return !input.text.trim() && input.toolCallCount === 0 && input.totalTokens === 0;
}

/**
 * Lượt dừng vì HẾT LƯỢT GỌI TOOL chứ không phải vì model xong việc.
 *
 * Nhận biết bằng CẤU TRÚC (đủ số step + step cuối vẫn còn gọi tool) thay vì
 * bằng `finishReason`: model xong việc thì step cuối không có tool call, còn
 * `stopWhen: stepCountIs(n)` cắt ngang đúng lúc model vừa gọi tool xong. Không
 * dùng `finishReason` vì trường đó do provider map, và `MockLanguageModel` của
 * SDK không truyền nó ra nên nhánh này sẽ không test được.
 *
 * Giờ chỉ còn dùng để GHI LOG lý do dừng. Quyết định có chạy lượt chốt hay
 * không thuộc về `canLuotChot` - xem giải thích ở đó.
 */
export function hitStepLimit(input: {
  stepCount: number;
  maxSteps: number;
  lastStepToolCalls: number;
}): boolean {
  return input.stepCount >= input.maxSteps && input.lastStepToolCalls > 0;
}

/**
 * Lượt có cần LƯỢT CHỐT không - tổng quát hơn `hitStepLimit`.
 *
 * Dấu hiệu quyết định là STEP CUỐI VẪN CÒN GỌI TOOL. Model xong việc thì step
 * cuối không gọi tool nữa; còn gọi nghĩa là vòng lặp bị cắt ngang giữa chừng,
 * nên `result.text` là câu tường thuật tiến trình ("Đủ 2 nguồn - giờ đối
 * chiếu") chứ không phải câu trả lời.
 *
 * Vì sao không dùng thẳng `hitStepLimit`: hàm đó còn đòi `stepCount >= maxSteps`,
 * đúng khi lý do dừng DUY NHẤT là hết step. Từ khi `stopWhen` có thêm điều kiện
 * token (`vuotTranToken`), lượt dừng sớm với `steps.length < maxSteps` sẽ trượt
 * khỏi nhánh đó và gửi thẳng câu tường thuật xuống Zalo - đúng cái bug mà lượt
 * chốt sinh ra để chữa.
 */
export function canLuotChot(input: { lastStepToolCalls: number }): boolean {
  return input.lastStepToolCalls > 0;
}

/**
 * Điều kiện dừng theo TOKEN, ghép cùng `stepCountIs` trong `stopWhen`.
 *
 * Dựa trên usage THẬT do provider trả về sau mỗi step, không phải ước lượng -
 * ước lượng chỉ dùng để cắt ngữ cảnh TRƯỚC lượt, còn trong lượt thì đã có số
 * thật để mà tin.
 *
 * `steps[].usage.inputTokens` là input của RIÊNG step đó (đã đo bằng
 * `MockLanguageModelV4` trên `ai@7.0.37`: mock trả 1000/3000/7000 thì từng step
 * đọc ra đúng ba số đó, còn `totalUsage` mới là 11000). Lấy max thay vì tổng:
 * cái quyết định có tràn cửa sổ hay không là lần gọi NẶNG NHẤT, còn tổng chỉ
 * nói lên tiền đã tiêu.
 *
 * Truyền vào phải là NGÂN SÁCH đã trừ hao (`nganSachAnToan`), không phải trần
 * thô: `usage` chỉ về sau khi lần gọi đó THÀNH CÔNG, nên so với trần thô thì
 * provider đã trả 400 trước khi hàm này kịp thấy con số vượt.
 */
export function vuotTranToken(tranToken: number) {
  return ({ steps }: { steps: readonly { usage?: { inputTokens?: number } }[] }): boolean => {
    if (tranToken <= 0) return false;
    let nangNhat = 0;
    for (const s of steps) nangNhat = Math.max(nangNhat, s.usage?.inputTokens ?? 0);
    return nangNhat >= tranToken;
  };
}

/**
 * Nhãn lý do vòng lặp dừng, cho dòng log mà người ta đọc để hiểu vì sao lượt cụt.
 *
 * Tách thành hàm thuần vì bản trước viết thẳng trong log và viết NHỊ PHÂN từ hồi
 * chỉ có hai điều kiện dừng (`hết step` : `chạm trần token`). Guard thêm vào sau
 * thành điều kiện thứ ba, nên mọi lần guard chặn đều bị ghi nhầm là chạm trần
 * token - chẩn đoán sai ngay ở manh mối đầu tiên. Ở đây thì sai lệch kiểu đó
 * kiểm được bằng test, không cần bắt log.
 *
 * Guard xét TRƯỚC: guard chặn thì vòng dừng vì guard, kể cả khi số step tình cờ
 * cũng vừa chạm trần.
 */
export function nhanLyDoDung(input: { maGuardChan?: string | null; hetStep: boolean }): string {
  if (input.maGuardChan) return `guard chặn (${input.maGuardChan})`;
  return input.hetStep ? "hết step" : "chạm trần token";
}
