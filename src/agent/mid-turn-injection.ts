import type { ModelMessage, UserContent } from "ai";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { buildCurrentTurnContent, type ImageContextMode } from "./agent-turn-content.js";
import { nganSachAnToan, TOKEN_MOI_ANH_THEO_CO, uocLuongTokenTinNhan } from "./token-estimate.js";

// Cùng scope với `agent-loop` chứ không đặt scope riêng: đọc log một lượt hỏng
// là đọc theo dòng thời gian của lượt đó, tách scope chỉ khiến phải ghép tay.
// Cùng lý do `agent-step-observer.ts` cũng dùng scope này.
const log = createLogger("agent-loop");

/**
 * Tiêm tin người dùng nhắn thêm vào GIỮA một lượt agent đang chạy.
 *
 * Bài toán còn lại sau khi bộ gộp đã biết dồn tin (`message-batcher.ts`): lượt
 * đầu vẫn phóng đi với bối cảnh thiếu. Ca thật ngày 2026-08-04 - người dùng trả
 * lời một câu, bot bắt đầu dựng tài liệu, 50 giây sau người dùng mới nhắn thêm
 * hai câu nữa làm rõ yêu cầu. Dồn tin chỉ hạ 3 lượt xuống 2; lượt đầu vẫn dựng
 * xong cả một tài liệu 18.000 ký tự theo yêu cầu chưa đủ.
 *
 * Điểm chèn là RANH GIỚI STEP - sau khi có kết quả tool, trước lần gọi LLM kế -
 * đúng chỗ goclaw dùng (`internal/pipeline/observe_stage.go` tiêu thụ
 * `InjectCh`). AI SDK cho đúng điểm đó qua `prepareStep`, và tài liệu của nó
 * nói rõ bản ghi đè `messages` "carry forward to later steps" nên chỉ cần chèn
 * một lần, các step sau tự mang theo.
 *
 * Đường Anthropic an toàn: bộ chuyển của `@ai-sdk/anthropic` gộp `tool` và
 * `user` vào CÙNG một khối `user` (`groupIntoBlocks`), nên chèn tin user ngay
 * sau kết quả tool không gây lỗi "roles must alternate".
 */

/**
 * Nhãn đặt trước nội dung tin chen.
 *
 * KHÔNG bọc `<noi_dung_ngoai>` như nội dung web: đây là lời người thật trong
 * cuộc trò chuyện, cùng mức tin cậy với tin mở đầu lượt (đã qua allowlist ở
 * `shouldRespond`). Bọc như dữ liệu ngoài sẽ dạy model phớt lờ đúng người nó
 * cần nghe.
 *
 * Nói "trong cuộc này" chứ KHÔNG nói "chính người đang trò chuyện với bạn":
 * `layTinDangDo` gom theo THREAD chứ không theo người gửi, nên trong nhóm tin
 * chen có thể đến từ thành viên khác với người mở lượt. Cả hai đều đã qua cùng
 * một cửa lọc nên mức tin cậy ngang nhau, nhưng khẳng định sai danh tính sẽ
 * khiến model gộp hai người thành một - đúng lúc `buildCurrentTurnContent` đã
 * dán nhãn tên người gửi khác ở ngay dưới.
 *
 * Nói rõ "đang làm dở" vì không có câu này model dễ đọc tin chen như một yêu
 * cầu MỚI hoàn toàn rồi bỏ ngang việc đang làm.
 */
export const NHAN_TIN_CHEN =
  "[Vừa có tin nhắn mới trong cuộc trò chuyện này trong lúc bạn đang làm dở. " +
  "Tên người gửi ghi ngay dưới đây. Tính nội dung đó vào việc đang làm: nếu nó " +
  "đổi yêu cầu thì đổi theo, nếu chỉ bổ sung thì làm tiếp cho trọn. Đừng bắt " +
  "đầu lại từ đầu, và đừng làm lại thứ đã xong.]";

/**
 * Dựng tin chen thành một `ModelMessage` vai `user`.
 *
 * Dùng LẠI `buildCurrentTurnContent` chứ không tự ghép chuỗi: hàm đó đã lo ảnh
 * theo đúng chế độ đang chạy (native/describe/hybrid/blind), nhãn tên người gửi
 * trong nhóm, và ca "gửi ảnh không kèm chữ". Viết đường thứ hai ở đây là chắc
 * chắn hai đường trôi khỏi nhau, và đường này sẽ là đường ít được để mắt hơn.
 */
export async function dungTinChen(
  tinMoi: ParsedMessage[],
  imageMode: ImageContextMode,
): Promise<ModelMessage> {
  const noiDung = await buildCurrentTurnContent(tinMoi, imageMode);
  // `UserContent` cho phép cả chuỗi trần lẫn mảng part. Thực tế hàm trên luôn
  // trả mảng, nhưng xử lý cả hai nhánh để đổi kiểu trả về ở đó không âm thầm
  // làm mất nhãn - đó là thứ duy nhất nói cho model biết đây là tin chen ngang.
  const nhan = { type: "text", text: NHAN_TIN_CHEN } as const;
  const content: Exclude<UserContent, string> =
    typeof noiDung === "string" ? [nhan, { type: "text", text: noiDung }] : [nhan, ...noiDung];
  return { role: "user", content };
}

/**
 * Phần ngân sách token mà tin chen được phép chiếm.
 *
 * Vì sao phải có: `messages` đã được cắt vừa ngân sách ở `buildTurnMessages`,
 * còn tin chen thì cộng THẲNG vào, không đi qua bộ cắt nào. Vài câu chữ thì vô
 * hại, nhưng `layTinDangDo` trả tối đa 32 tin và mỗi tin có thể kèm nhiều ảnh -
 * ở chế độ `native` mỗi ảnh là một khối base64 đầy đủ. Người ta gửi 8 tấm ảnh
 * trong lúc bot đang chạy là đủ đẩy một ngữ cảnh vốn đã sát trần vượt luôn.
 *
 * Không dựa vào đường tự chữa (`context_overflow` cắt sâu rồi thử lại): nó tốn
 * trọn một lần gọi model, mà lần gọi đó đằng nào cũng hỏng.
 */
const TY_LE_TRAN_TIN_CHEN = 0.25;

/**
 * Dựng tin chen, và nếu nó quá to thì dựng lại KHÔNG kèm ảnh.
 *
 * Bỏ ảnh giữ chữ chứ không bỏ cả tin: chữ mới là thứ đổi yêu cầu, còn ảnh vẫn
 * nằm trong history nên lượt sau đọc lại được.
 */
export async function dungTinChenTrongNganSach(
  moi: ParsedMessage[],
  imageMode: ImageContextMode,
  tranToken: number,
): Promise<ModelMessage> {
  const tinChen = await dungTinChen(moi, imageMode);
  const coAnh = getTuning("ZALO_IMAGE_QUALITY");
  const uocLuong = uocLuongTokenTinNhan([tinChen], TOKEN_MOI_ANH_THEO_CO[coAnh]);
  const tran = Math.floor(nganSachAnToan(tranToken) * TY_LE_TRAN_TIN_CHEN);
  if (tran <= 0 || uocLuong <= tran) return tinChen;

  log.warn(
    { uocLuong, tran, soTin: moi.length },
    "Tin chen quá lớn so với ngân sách - dựng lại KHÔNG kèm ảnh để không đẩy ngữ cảnh tràn",
  );
  return dungTinChen(moi, "blind");
}

/**
 * Dựng hàm cho `prepareStep` của vòng lặp agent.
 *
 * TOÀN BỘ thân hàm nằm trong try/catch và mọi nhánh hỏng đều trả `{}` (không
 * đổi gì). Đây là nhánh LÀM TỐT THÊM, không phải nhánh bắt buộc: một lỗi ở đây
 * - hàng chờ hỏng, ảnh của tin chen tải không được - mà ném ra thì nó giết cả
 * lượt đang chạy tốt, đúng lượt vừa tốn mấy phút gọi tool. Thà bỏ lượt chèn
 * còn hơn mất câu trả lời.
 */
export function taoBoChenTin(input: {
  /** Không truyền = tắt hẳn đường này (lượt theo lịch không truyền) */
  layTinChen?: () => ParsedMessage[] | Promise<ParsedMessage[]>;
  /**
   * Chế độ ảnh HIỆN TẠI - phải là hàm chứ không phải giá trị: nó đổi giữa lượt
   * khi provider từ chối pixel và vòng lặp dựng lại input không kèm ảnh. Truyền
   * giá trị là tin chen bị dựng theo chế độ đã hết hiệu lực, và lượt vừa bị từ
   * chối vì ảnh lại nhận thêm ảnh.
   */
  layImageMode: () => ImageContextMode;
  /** Trần token của MODEL đang chạy - để biết tin chen bao nhiêu là quá to */
  layTranToken: () => number;
  /** Xóa bộ đếm chống lặp tool khi có tin chen */
  guard: { datLai: () => void };
}) {
  return async (
    tinHienTai: ModelMessage[],
  ): Promise<{ messages: ModelMessage[] } | Record<string, never>> => {
    if (!input.layTinChen || !getTuning("MID_TURN_INJECTION_ENABLED")) return {};
    try {
      const moi = await input.layTinChen();
      if (moi.length === 0) return {};

      const tinChen = await dungTinChenTrongNganSach(moi, input.layImageMode(), input.layTranToken());

      // Xóa bộ đếm guard: tin chen là NGỮ CẢNH MỚI, không được mang tội của
      // phần trước sang. Model đang bí với hướng cũ nên gọi lặp một tool, giờ
      // người dùng vừa đổi hướng - chặn nó bằng bộ đếm của hướng cũ là chặn
      // đúng việc mới. Cùng lý do đã dùng cho các nhánh `lanChay++`. Không sợ
      // chạy vô hạn: trần step vẫn chặn, và trần đó KHÔNG được đặt lại.
      input.guard.datLai();

      log.info(
        { soTin: moi.length, tuNguoi: moi[moi.length - 1]?.senderName },
        "Chèn tin người dùng nhắn thêm vào giữa lượt đang chạy",
      );
      return { messages: [...tinHienTai, tinChen] };
    } catch (err) {
      log.error({ err }, "Chèn tin giữa lượt lỗi - bỏ qua, lượt vẫn chạy tiếp bình thường");
      return {};
    }
  };
}
