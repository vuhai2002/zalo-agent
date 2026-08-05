import type { API, Style, ThreadType } from "zca-js";
import { enqueueSend } from "../middleware/rate-limiter.js";
import { createLogger } from "../shared/logger.js";
import { chiaTheoNganSachByte, demDoanBoDinhDang } from "./split-styled-message.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

/**
 * Gửi câu trả lời của agent xuống Zalo, cắt thành nhiều tin khi quá dài.
 *
 * Zalo chặn tin dài ở phía server (error_code 118 "Nội dung quá dài") và zca-js
 * ném thẳng lỗi lên - trước đây cả câu trả lời biến mất không dấu vết. Giờ cắt
 * theo ranh giới tự nhiên rồi gửi tuần tự qua rate-limiter (mỗi tin có delay
 * ngẫu nhiên sẵn nên chuỗi tin trông như người gõ nhiều dòng, không phải bot xả).
 */

const log = createLogger("send-reply");

/**
 * Câu trả lời khi bot hỏng giữa chừng. Im lặng bỏ treo người nhắn là hành vi
 * tệ nhất: họ không biết nên chờ hay nhắn lại.
 */
export const TECHNICAL_ERROR_REPLY =
  "Mình đang gặp trục trặc kỹ thuật nên chưa trả lời được tin này, bạn nhắn lại giúp mình sau ít phút nhé.";

/**
 * Câu riêng cho từng loại lỗi provider.
 *
 * Một câu cho mọi thứ là nói dối người nhắn: "bot hết quota" và "mạng chập" đọc
 * ra y hệt nhau, nên họ không biết nên chờ hay báo cho chủ bot.
 *
 * Cả ba câu đều viết bằng lời thường, KHÔNG lộ chi tiết kỹ thuật (mã lỗi, tên
 * provider, endpoint) - người nhắn có thể là người lạ, chi tiết chỉ đi vào log.
 */
export const LOI_THEO_LOAI: Record<string, string> = {
  rate_limit:
    "Mình đang bị quá tải nên chưa trả lời kịp tin này, bạn nhắn lại giúp mình sau vài phút nhé.",
  // Đây là lỗi CẤU HÌNH, chờ bao lâu cũng không tự hết - phải nói khác hẳn
  // câu "thử lại sau", kẻo người nhắn ngồi đợi vô vọng.
  auth: "Phần kết nối của mình đang có vấn đề về cấu hình, mình đã báo lại cho chủ bot. Bạn nhắn lại sau nhé.",
  // Khác `auth` ở chỗ chưa nhập gì cả, chứ không phải nhập sai. Người nhắn
  // không cần biết chi tiết đó, nhưng câu phải nói rõ là CHƯA DÙNG ĐƯỢC chứ
  // không phải trục trặc thoáng qua - nếu không họ sẽ nhắn lại mỗi vài phút.
  cau_hinh:
    "Bot mình chưa được cài đặt xong nên chưa trả lời được. Mình đã báo cho chủ bot, bạn quay lại sau nhé.",
};

/** Câu hợp với loại lỗi; loại lạ thì rơi về câu chung */
export function cauLoiTheoLoai(loai: string | undefined): string {
  return (loai && LOI_THEO_LOAI[loai]) || TECHNICAL_ERROR_REPLY;
}

export type ReplyTarget = {
  api: API;
  /** Khóa hàng đợi gửi của rate-limiter: `${accountId}:${threadId}` */
  threadKey: string;
  threadId: string;
  threadType: ThreadType;
};

export type ReplyResult = {
  /** Phần đã gửi được thật sự - ghi vào history đúng cái người dùng nhìn thấy */
  deliveredText: string;
  /** Số tin đã gửi */
  sentParts: number;
  /** Lỗi ở tin đầu tiên gửi hỏng (nếu có) - caller quyết định báo cho người dùng */
  error?: unknown;
};

/**
 * Gửi 1 tin qua hàng đợi của thread (giữ thứ tự + delay ngẫu nhiên).
 *
 * Chỉ đính `styles` khi thật sự có - `sendMessage` của zca-js chỉ dựng
 * `textProperties` khi trường này khác rỗng, gửi mảng rỗng là thêm việc thừa.
 */
function sendOne(target: ReplyTarget, text: string, styles?: Style[]): Promise<unknown> {
  const msg = styles && styles.length > 0 ? { msg: text, styles } : { msg: text };
  return enqueueSend(target.threadKey, () =>
    target.api.sendMessage(msg, target.threadId, target.threadType),
  );
}

/**
 * Máy chủ Zalo có TRẢ LỜI và từ chối, hay là lỗi đường truyền không rõ kết cục?
 *
 * Phân biệt được điều này mới dám gửi lại: máy chủ đã từ chối nghĩa là KHÔNG có
 * tin nào lọt qua, gửi lại là an toàn. Còn timeout hay đứt mạng thì tin có thể
 * đã tới nơi - gửi lại là nhân đôi tin trước mặt người dùng.
 *
 * Dấu hiệu: zca-js gắn `code` dạng số cho lỗi do máy chủ trả về
 * (`ZaloApiError`), lỗi mạng thì không có.
 */
export function laLoiMayChuTuChoi(err: unknown): boolean {
  return typeof (err as { code?: unknown } | null)?.code === "number";
}

/**
 * Gửi một đoạn; bị máy chủ từ chối thì thử lại đúng MỘT lần, bỏ định dạng.
 *
 * Vì sao cần: 2026-08-05 một câu trả lời có tiêu đề kèm in đậm sinh ra hai span
 * `b` chồng nhau, Zalo trả mã 112 và người dùng mất trọn câu trả lời sau 8 lượt
 * tra web. `chuanHoaStyles` đã bịt đúng ca đó, nhưng luật kiểm của Zalo là hộp
 * đen - không có cách nào liệt kê cho đủ. Nên thay vì đoán cho hết, hạ mức hậu
 * quả: tổ hợp style lạ chỉ còn làm tin NHẠT ĐI, không làm mất nội dung.
 *
 * Chỉ thử lại khi thật sự CÓ style để bỏ - không thì lần hai y hệt lần đầu và
 * chỉ tổ nhân đôi một lời gọi API không chính thức.
 */
async function sendOneCoDuongLui(
  target: ReplyTarget,
  text: string,
  styles: Style[],
): Promise<unknown> {
  try {
    return await sendOne(target, text, styles);
  } catch (err) {
    if (styles.length === 0 || !laLoiMayChuTuChoi(err)) throw err;

    // WARN chứ không debug: mất định dạng là hỏng thầm lặng, người vận hành
    // phải thấy được để còn lần ra tổ hợp style nào bị Zalo chê.
    log.warn(
      { threadId: target.threadId, soStyle: styles.length, err },
      "Zalo từ chối tin có định dạng - gửi lại dạng chữ trơn",
    );
    return await sendOne(target, text);
  }
}

/**
 * Cắt (nếu cần) rồi gửi lần lượt. Một tin hỏng thì dừng luôn phần còn lại -
 * gửi tiếp các đoạn sau sẽ ra một câu trả lời thủng lỗ chỗ, khó đọc hơn là
 * dừng và báo lỗi.
 *
 * `styles` tính trên TOÀN VĂN nên phải chẻ theo đúng chỗ cắt - việc đó nằm ở
 * `splitStyledMessage`, không tự làm ở đây.
 */
export async function sendReplyInParts(
  target: ReplyTarget,
  text: string,
  styles: Style[] = [],
): Promise<ReplyResult> {
  const parts = chiaTheoNganSachByte(
    { text, styles },
    {
      maxChars: getTuning("ZALO_MAX_MESSAGE_CHARS"),
      maxParts: getTuning("ZALO_MAX_MESSAGE_PARTS"),
      maxPayloadBytes: getTuning("ZALO_RICH_TEXT_MAX_PAYLOAD_BYTES"),
    },
  );

  if (parts.length === 0) return { deliveredText: "", sentParts: 0 };

  if (parts.length > 1) {
    log.info(
      { threadId: target.threadId, length: text.length, parts: parts.length },
      "Câu trả lời dài - cắt thành nhiều tin",
    );
  }

  // Bộ cắt có quyền bỏ định dạng của một đoạn khi co hết cỡ vẫn không lọt ngân
  // sách byte. Nhánh đó phải KÊU LÊN: bản đầu làm việc này lặng lẽ, và lỗi chỉ
  // lộ ra vì người dùng nhìn thấy tin đầu phẳng lì - log không hề nhắc gì.
  // Đếm theo CỜ, không theo `styles.length === 0`: đoạn cuối thường chỉ là văn
  // xuôi nên vốn không có span nào, mà suy ra từ độ dài thì đó là báo động giả.
  const doanMatDinhDang = demDoanBoDinhDang(parts);
  if (doanMatDinhDang > 0) {
    log.warn(
      { threadId: target.threadId, doanMatDinhDang, tongDoan: parts.length },
      "Đoạn quá nặng so với trần byte của Zalo - gửi đoạn đó dạng chữ trơn",
    );
  }

  const delivered: string[] = [];
  for (const part of parts) {
    try {
      await sendOneCoDuongLui(target, part.text, part.styles);
      delivered.push(part.text);
    } catch (err) {
      log.error(
        { threadId: target.threadId, partIndex: delivered.length + 1, total: parts.length, err },
        "Gửi tin thất bại",
      );
      return { deliveredText: delivered.join("\n"), sentParts: delivered.length, error: err };
    }
  }

  return { deliveredText: delivered.join("\n"), sentParts: delivered.length };
}

/**
 * Lần cuối đã báo lỗi cho mỗi (thread + loại lỗi).
 *
 * Map sống suốt đời process nhưng KHÔNG rò rỉ đáng kể: khóa chỉ sinh ra khi có
 * lỗi thật, và mỗi thread nhiều nhất vài loại. Một bot chat với hàng nghìn
 * người mà lỗi ở cả nghìn thread thì bộ nhớ của Map này là chuyện nhỏ nhất.
 */
const lanBaoLoiCuoi = new Map<string, number>();

/**
 * Khoảng lặng giữa hai lần báo CÙNG một loại lỗi cho CÙNG một thread.
 *
 * Vì sao cần: provider chết 10 phút mà người ta nhắn 5 lần là 5 tin y hệt nhau
 * đổ xuống - vừa phiền vừa làm họ tưởng bot hỏng nặng hơn thực tế. Một lần đã
 * nói đủ ý "chờ rồi nhắn lại".
 *
 * Khóa gồm CẢ loại lỗi, không chỉ thread: "bot chưa cấu hình xong" và "mạng
 * chập" là hai chuyện khác nhau và mỗi chuyện đáng được nói một lần. Nuốt câu
 * thứ hai vì câu thứ nhất vừa gửi là giấu đúng thông tin người ta cần.
 */
const KHOANG_LANG_BAO_LOI_MS = 60_000;

/**
 * Báo cho người nhắn biết bot đang hỏng. Tự nuốt lỗi: đây đã là đường cứu cánh,
 * hỏng nốt thì chỉ còn cách ghi log.
 *
 * Bỏ qua nếu vừa báo đúng loại lỗi này cho thread này - xem
 * `KHOANG_LANG_BAO_LOI_MS`.
 */
export async function notifyTechnicalError(target: ReplyTarget, loaiLoi?: string): Promise<void> {
  const khoa = `${target.threadKey}:${loaiLoi ?? "chung"}`;
  const lanCuoi = lanBaoLoiCuoi.get(khoa) ?? 0;
  const bayGio = Date.now();
  if (bayGio - lanCuoi < KHOANG_LANG_BAO_LOI_MS) {
    log.debug({ threadId: target.threadId, loaiLoi }, "Vừa báo lỗi này rồi - không gửi lại");
    return;
  }
  // Đánh dấu TRƯỚC khi gửi: gửi là việc async, hai lượt hỏng gần nhau có thể
  // cùng đi qua chỗ kiểm ở trên rồi cùng gửi. Đánh dấu sau thì cửa sổ đó vẫn hở.
  lanBaoLoiCuoi.set(khoa, bayGio);

  try {
    await sendOne(target, cauLoiTheoLoai(loaiLoi));
  } catch (err) {
    log.error({ threadId: target.threadId, err }, "Không gửi được cả thông báo lỗi");
  }
}

/** Xóa bộ nhớ khử trùng - chỉ test dùng, để các ca không ảnh hưởng lẫn nhau */
export function resetKhuTrungBaoLoi(): void {
  lanBaoLoiCuoi.clear();
}
