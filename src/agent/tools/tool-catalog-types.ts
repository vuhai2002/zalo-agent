import type { Tool } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../../config/account-store.js";
import type { AgentProfile } from "../../config/agent-store.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

/**
 * Hình dạng dữ liệu dùng chung cho catalog tool - tách riêng khỏi
 * `tool-catalog.ts` (giữ `TOOL_DEFINITIONS`) và các file `tool-catalog-*.ts`
 * theo nhóm (`tool-catalog-read.ts`, `tool-catalog-action.ts`), để 3 file đó
 * chỉ cần import TYPE từ đây thay vì import lẫn nhau (đổi 1 tool trong nhóm
 * action không kéo theo phải đọc/hiểu nhóm read).
 */

/** Bối cảnh 1 lượt xử lý - tools dùng để gọi zca-js đúng account + thread */
export type ToolContext = {
  api: API;
  account: AccountConfig;
  /**
   * Agent đang chạy lượt này. BẮT BUỘC (không optional) vì nó là một trong hai
   * lớp quyết định tool nào được cấp - để optional thì quên truyền sẽ âm thầm
   * cấp thừa tool thay vì báo lỗi biên dịch. Xem `ToolScope` ở
   * `tool-registry.ts`.
   */
  agent: AgentProfile;
  /** Tin cuối của lượt - tools tác động (reaction, quote) nhắm vào tin này */
  message: ParsedMessage;
  /**
   * Cả batch của lượt (ảnh và caption Zalo gửi tách tin). read_image cần vì
   * ảnh của lượt hiện tại CHƯA vào DB khi tool chạy - đọc history là hụt.
   */
  batch: ParsedMessage[];
  /**
   * Lượt CHẠY THEO LỊCH (job scheduler agent-loop.ts truyền `isolated:true`
   * xuống đây) - lọc bớt tool theo `runsInScheduledTurn`. Mặc định false/undefined
   * cho lượt tin nhắn thường.
   */
  isolated?: boolean;
  /**
   * Báo cho caller biết tool vừa GỬI một tin xuống Zalo, để tin đó vào history.
   *
   * 5 tool gửi thẳng qua `enqueueSend`, không đi qua `deliverChatReply` - mà đó
   * mới là chỗ duy nhất gọi `appendMessage`. Không có đường này thì tin bot gửi
   * biến mất khỏi dashboard VÀ khỏi trí nhớ của chính bot ở lượt sau.
   *
   * Chỉ GHI NHẬN, không tự ghi DB: thứ tự trong history do
   * `message-turn-processor` quyết (tin người dùng ghi ở CUỐI lượt, nên tool
   * ghi thẳng lúc gửi sẽ nằm nhầm phía trước). Cùng nếp sở hữu mảng với `trace`.
   *
   * Optional vì lượt theo lịch không truyền - 5 tool này vốn đã bị loại khỏi
   * lượt đó (`runsInScheduledTurn: false`).
   */
  ghiNhanDaGui?: (noiDung: string) => void;
};

/**
 * Nhóm theo mức rủi ro (học từ toolset của Hermes - webhook chỉ được cấp
 * tool "đọc"): read = tra cứu, không tác động ra ngoài; action = gửi/sửa
 * thứ gì đó trên Zalo. UI trang Tools nhóm theo đây.
 */
export type ToolGroup = "read" | "action";

export type ToolDefinition = {
  /** Tên tool trong schema gửi LLM - đổi là model mất trí nhớ về tool */
  key: string;
  /** Tên + mô tả hiển thị trên trang Tools của dashboard */
  label: string;
  description: string;
  group: ToolGroup;
  /**
   * Có nút Settings trên dòng tool ở dashboard không. Tool nào đi theo CHUỖI
   * nhiều nguồn thì có, để người dùng xem thứ tự thử và bật/tắt từng bậc
   * (mô hình Extractor Chain của GoClaw).
   */
  hasSettings?: boolean;
  /**
   * Điều kiện runtime để tool vào schema (kiểm mỗi lượt, ngoài chuyện bật/tắt
   * per account). Tool thiếu hạ tầng (read_image chưa có sidecar) mà vẫn vào
   * schema thì chỉ tốn token mô tả và dụ model gọi để nhận lỗi.
   */
  available?: () => boolean;
  /**
   * Hiện trên trang Tools khi `available()` false - phải nói RÕ thiếu gì và
   * sửa ở đâu. Không có dòng này thì UI hiện tool bật sẵn trong khi model
   * không hề nhận được nó (người dùng tưởng bot có khả năng đó mà không có).
   */
  unavailableHint?: string;
  /**
   * Tool này có đáng kể ra khi ai đó hỏi "bạn làm được gì" không.
   *
   * Mặc định CÓ - phải khai tường minh `false` mới bị loại, để tool mới thêm
   * không âm thầm biến mất khỏi lời giới thiệu.
   *
   * Vì sao cần: mục Khả năng liệt kê thẳng từ danh bạ này, nên có tool là hạ
   * tầng chứ không phải năng lực người dùng quan tâm cũng lọt vào. Người dùng
   * nói thẳng khi thấy bot khoe "xem ngày giờ chính xác": "cái đó tôi cũng xem
   * được, đưa vào năng lực làm gì". Khoe những thứ ai cũng làm được thì cả danh
   * sách trông nghiệp dư.
   *
   * KHÁC hẳn việc tắt tool: model VẪN nhận schema và vẫn gọi được bình thường,
   * chỉ là không đem ra quảng cáo.
   */
  keTrongKhaNang?: boolean;
  /**
   * Tool này có được cấp trong lượt CHẠY THEO LỊCH (job scheduler) không.
   * Mặc định true - phải khai TƯỜNG MINH false mới bị loại. Chín tool loại,
   * hai nhóm lý do khác nhau:
   *
   * - Không có hạ tầng cho lượt cô lập: `add_reaction` (không có `msgId` thật
   *   để thả vào), `read_image` (không có ảnh nào trong lượt), `save_memory`
   *   (đường nội dung web đi vào trí nhớ vĩnh viễn là prompt injection thật,
   *   và lượt theo lịch vốn không có phát ngôn nào của user để mà học),
   *   `schedule_task` (luật số 1 của Hermes: job không được đẻ job).
   * - Gửi tin THẲNG qua `enqueueSend` (rate-limiter THEO THREAD của
   *   `middleware/rate-limiter.ts`), KHÔNG đi qua `deliverProactively`/
   *   `reserveProactiveSlot` của scheduler - vào lượt theo lịch sẽ né hoàn
   *   toàn trần `SCHEDULER_MAX_PROACTIVE_PER_DAY` vì bộ đếm trần chỉ tăng ở
   *   đường đó: `send_file`, `create_word_document`, `create_excel_file`,
   *   `create_image`, `tag_member`. Loại tới khi nhóm này có đường đếm trần
   *   đúng đắn (đợt sau) - báo cáo dạng CHỮ (kind='message'/'agent' trả text)
   *   vẫn là use case chính, không bị ảnh hưởng.
   */
  runsInScheduledTurn?: boolean;
  build: (ctx: ToolContext) => Tool;
};
