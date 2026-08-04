/**
 * Gom kết quả `streamText` về ĐÚNG hình dạng mà `generateText` từng trả, và vá
 * lại chỗ `streamText` đánh mất lỗi gốc.
 *
 * Vì sao lượt agent phải đi đường streaming dù không hề stream chữ xuống Zalo:
 * router 9Router nằm sau Cloudflare, mà Cloudflare cắt kết nối bằng 524 khi
 * origin chưa trả BYTE ĐẦU TIÊN trong 100 giây. Request non-stream buộc router
 * gom trọn câu trả lời rồi mới gửi, nên byte đầu chỉ xuất hiện sau khi model
 * sinh xong - mọi lượt sinh dài (tạo tài liệu, bài giảng) đều vượt mốc đó.
 *
 * Đo thật trên router của dự án, cùng một prompt sinh ~4000 chữ:
 *   stream=false -> HTTP 524 (trang lỗi HTML của Cloudflare) ở giây thứ 125
 *   stream=true  -> HTTP 200, byte đầu ở giây thứ 7,5, xong ở giây thứ 135
 * Lượt streaming chạy LÂU HƠN mốc bị cắt mà vẫn qua: Cloudflare đếm thời gian
 * tới byte đầu, không đếm tổng thời lượng.
 *
 * Module THUẦN: không log, không đọc env, không chạm DB.
 */

/**
 * Bộ bắt lỗi thật của một lần chạy `streamText`.
 *
 * ĐÂY LÀ PHẦN KHÔNG ĐƯỢC BỎ. `streamText` của ai@7.0.37 KHÔNG ném lỗi gốc ra
 * ngoài: khi stream hỏng, nó đưa lỗi thật cho `onError` rồi tới lúc `flush`
 * thấy chưa ghi được step nào thì reject các promise bằng một
 * `NoOutputGeneratedError` DỰNG MỚI (`stream-text.ts:1384-1391`). Lỗi gốc rơi
 * mất ngay tại đó.
 *
 * Hậu quả nếu để nguyên: `phanLoaiLoiProvider` mất sạch mã HTTP nên mọi lỗi ra
 * `unknown` - sai khóa (401) bị xử như mạng chập và người nhắn nhận câu "thử
 * lại sau ít phút" trong khi chờ bao lâu cũng không tự hết; 429 mất
 * `Retry-After`; tràn ngữ cảnh mất đường cắt sâu; 4xx của lượt đính ảnh mất
 * đường dựng lại không kèm pixel. Tức là cả tầng chữa lỗi provider thành mù.
 *
 * Giữ lỗi ĐẦU TIÊN vì lỗi sau thường là hệ quả dây chuyền, nhưng nói thẳng:
 * KHÔNG có test nào ghim lựa chọn này. Đã thử đổi sang giữ lỗi cuối thì cả bộ
 * test vẫn xanh - trong mọi đường đang đo, `onError` chỉ nổ đúng một lần. Giữ
 * "đầu tiên" vì nó đúng hơn cho việc lần nguyên nhân gốc, không phải vì đã
 * chứng minh được khác biệt.
 *
 * PHẢI dựng MỚI cho mỗi lần gọi `streamText`. Dùng chung một bộ cho cả lượt
 * thì lỗi của lần chạy trước còn nằm đó, và lần thử lại dù THÀNH CÔNG vẫn bị
 * ném - đúng những đường chữa lỗi (429, tràn ngữ cảnh, bỏ pixel) sinh ra để
 * cứu lượt lại thành thứ giết lượt.
 */
export function taoBoBatLoiStream(ghiLog?: (loi: unknown) => void) {
  let loi: unknown;
  let daBat = false;

  return {
    /** Truyền thẳng vào `onError` của `streamText` */
    onError: ({ error }: { error: unknown }): void => {
      ghiLog?.(error);
      if (daBat) return;
      daBat = true;
      loi = error;
    },

    /**
     * Lỗi THẬT nếu bắt được, không thì trả lại `thayThe`.
     *
     * Kiểm `!== undefined` chứ không chỉ kiểm `daBat`: một `onError` được gọi
     * với `error: undefined` mà thay thế bừa sẽ biến lỗi đọc được thành
     * `throw undefined` - còn khó lần hơn cả `NoOutputGeneratedError`.
     */
    loiThat: (thayThe: unknown): unknown => (daBat && loi !== undefined ? loi : thayThe),

    /** Có lỗi nào đọc được không - dùng cho ca stream lỗi mà promise vẫn resolve */
    coLoi: (): boolean => daBat && loi !== undefined,
  };
}

export type BoBatLoiStream = ReturnType<typeof taoBoBatLoiStream>;

/**
 * Đọc hết stream rồi trả về hình dạng của `generateText`.
 *
 * Generic theo từng trường để suy kiểu của caller giữ nguyên (kiểu tool trong
 * `steps` chẳng hạn); khai `ReturnType<typeof streamText>` sẽ rơi về generic
 * mặc định và làm mất kiểu tool.
 *
 * Phải await ở đây chứ không trả thẳng object của `streamText` ra ngoài:
 * `streamText(...)` KHÔNG ném đồng bộ - nó trả object rồi lỗi mới nổi lên lúc
 * await. Không await thì `try/catch` của caller thành vô dụng.
 *
 * `Promise.all` gắn handler cho MỌI promise nên một promise reject không để lại
 * unhandled rejection ở các promise còn lại. Chỉ cần một trong số chúng chạm
 * tới là stream tự được tiêu thụ (`get steps()` gọi `consumeStream()`).
 */
export async function gomKetQuaStream<
  Steps,
  Usage,
  Finish,
  Resp extends object,
  Msgs,
>(
  ketQua: {
    text: PromiseLike<string>;
    steps: PromiseLike<Steps>;
    totalUsage: PromiseLike<Usage>;
    finishReason: PromiseLike<Finish>;
    response: PromiseLike<Resp>;
    responseMessages: PromiseLike<Msgs>;
  },
  batLoi?: BoBatLoiStream,
): Promise<{
  text: string;
  steps: Steps;
  totalUsage: Usage;
  finishReason: Finish;
  response: Resp & { messages: Msgs };
}> {
  let text: string;
  let steps: Steps;
  let totalUsage: Usage;
  let finishReason: Finish;
  let response: Resp;
  let messages: Msgs;

  try {
    [text, steps, totalUsage, finishReason, response, messages] = await Promise.all([
      ketQua.text,
      ketQua.steps,
      ketQua.totalUsage,
      ketQua.finishReason,
      ketQua.response,
      ketQua.responseMessages,
    ]);
  } catch (err) {
    // Ném lỗi THẬT chứ không ném cái vỏ `NoOutputGeneratedError` - xem
    // `taoBoBatLoiStream` để biết vì sao cả tầng chữa lỗi phụ thuộc vào đây.
    throw batLoi ? batLoi.loiThat(err) : err;
  }

  // Stream hỏng mà promise VẪN resolve: `flush` chỉ reject khi chưa ghi được
  // step nào (`stream-text.ts:1384`). Lượt đi tốt step 1 rồi step 2 gặp 524 sẽ
  // rơi vào đây - trả về kết quả CỤT và lỗi biến mất không dấu vết.
  //
  // `generateText` trước đây NÉM trong đúng ca này, và cả vòng lặp dựng theo
  // giả định đó: `chuaLoiProvider` phân loại rồi chữa, `message-turn-processor`
  // báo người nhắn. Nuốt lỗi ở đây thì lượt cụt đi tiếp vào lượt chốt và người
  // nhắn nhận câu "mình tra hơi nhiều bước mà chưa gom đủ" - đổ tại hết lượt
  // trong khi thật ra router chết. Giữ nguyên hợp đồng cũ: có lỗi thì ném.
  if (batLoi?.coLoi()) throw batLoi.loiThat(undefined);

  // `generateText` gộp `messages` vào trong `response`; `streamText` tách ra
  // thành `responseMessages`. Ghép lại để lượt chốt vẫn đọc được
  // `result.response.messages` như cũ.
  return { text, steps, totalUsage, finishReason, response: { ...response, messages } };
}

/**
 * Cách DUY NHẤT nên gọi `streamText` trong dự án này.
 *
 * Nhận một hàm dựng chứ không nhận thẳng object tham số: caller viết
 * `streamText({...})` tại chỗ nên mọi suy kiểu generic (kiểu tool trong
 * `steps`) giữ nguyên, mà `onError` thì không thể quên nối - quên là rơi lại
 * đúng hai cái bẫy đã mô tả ở `taoBoBatLoiStream`.
 *
 * `ghiLog` để caller tự chọn logger của mình; module này không log.
 */
export function chayStream<Steps, Usage, Finish, Resp extends object, Msgs>(
  tao: (onError: (thongTin: { error: unknown }) => void) => {
    text: PromiseLike<string>;
    steps: PromiseLike<Steps>;
    totalUsage: PromiseLike<Usage>;
    finishReason: PromiseLike<Finish>;
    response: PromiseLike<Resp>;
    responseMessages: PromiseLike<Msgs>;
  },
  ghiLog?: (loi: unknown) => void,
): Promise<{
  text: string;
  steps: Steps;
  totalUsage: Usage;
  finishReason: Finish;
  response: Resp & { messages: Msgs };
}> {
  // Dựng MỚI mỗi lần gọi - xem `taoBoBatLoiStream` để biết vì sao dùng chung
  // là tự phá các đường chữa lỗi.
  const batLoi = taoBoBatLoiStream(ghiLog);
  return gomKetQuaStream(tao(batLoi.onError), batLoi);
}
