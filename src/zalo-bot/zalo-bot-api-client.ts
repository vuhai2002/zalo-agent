import type {
  KetQuaGuiTin,
  ZaloBotEnvelope,
  ZaloBotMessage,
  ZaloBotUpdate,
} from "./zalo-bot-api-types.js";

/**
 * Client Zalo Bot API - viết thẳng trên `fetch`, KHÔNG dùng SDK bên thứ ba.
 *
 * Vì sao không dùng SDK dù có sẵn vài cái trên npm: toàn bộ API là 10 method
 * JSON thuần, đo được là ~150 dòng. Ba gói phổ biến đều mang giá không đáng
 * trả - `zalo-bot-js` kéo theo `sqlite3` (cần Visual Studio Build Tools trên
 * Windows, đúng thứ dự án đã tránh khi chọn `node:sqlite`), `sharp` và cả một
 * thư viện dịch thuật; `node-zalo-bot` là fork cũ của `node-telegram-bot-api`
 * với `bl@1`/`file-type@3`. So sánh với `zca-js`: repo đó xứng đáng làm
 * dependency vì nó là giao thức ĐẢO NGƯỢC hàng chục nghìn dòng đổi liên tục
 * theo Zalo Web - còn một REST API 10 method có tài liệu chính thức thì ngược lại.
 *
 * `fetchImpl` tiêm được để test không đi ra mạng - cùng khuôn với
 * `image-generation-client.ts`.
 */

export const GOC_API_MAC_DINH = "https://bot-api.zaloplatforms.com";

/**
 * Mã lỗi Zalo trả khi HẾT HẠN CHỜ mà không có tin nào - đây là kết cục BÌNH
 * THƯỜNG của long polling, không phải sự cố.
 *
 * Đo trên API thật: `{"ok":false,"description":"Request timeout","error_code":408}`
 * kèm HTTP 200, trả về đúng sau số giây đã xin (đo 5015ms / 10029ms / 30042ms
 * cho timeout 5/10/30). Bắt theo MÃ SỐ chứ không theo chữ "Request timeout" -
 * chữ có thể đổi hoặc bị dịch, mã thì không.
 */
export const MA_LOI_HET_HAN_CHO = 408;

export class LoiZaloBotApi extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly httpStatus?: number,
    readonly maLoi?: number | string,
  ) {
    super(message);
    this.name = "LoiZaloBotApi";
  }
}

export type ThamSoClient = {
  token: string;
  gocApi?: string;
  /** Timeout cho lời gọi THƯỜNG. Vòng poll tự truyền hạn riêng, dài hơn hẳn. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function taoZaloBotClient(p: ThamSoClient) {
  const gocApi = p.gocApi ?? GOC_API_MAC_DINH;
  const fetchImpl = p.fetchImpl ?? fetch;
  const timeoutMs = p.timeoutMs ?? 15_000;

  /**
   * Che token trong MỌI chuỗi sắp đi vào thông điệp lỗi.
   *
   * Không thừa: token nằm trong ĐƯỜNG DẪN (`/bot{token}/{method}`), và nhánh
   * "thân không phải JSON" bên dưới dán tối đa 200 ký tự thân trả về vào
   * `err.message`. Thân đó là của CỔNG TRUNG GIAN chứ không phải của Zalo -
   * nhiều cổng (Apache, WAF, CDN) echo lại đường dẫn trong trang lỗi. Đã dựng
   * lại được: token đi từ đó vào `warning` của `PATCH /api/accounts/:id` (tức
   * lên màn hình dashboard) và vào `data/logs/bot.*.log` qua log lúc khởi động.
   *
   * Tài liệu kiến trúc đã ghi số đo "poll dồn dập -> nginx trả HTML" nên nhánh
   * này chắc chắn có người đi tới.
   */
  const che = (chu: string) => {
    const thay = p.token ? chu.split(p.token).join("<token>") : chu;
    // Lớp thứ hai theo HÌNH DẠNG: cổng trung gian có thể trả đường dẫn đã
    // URL-encode (`%3A` thay cho `:`) hoặc HTML-escape, khi đó phép thay nguyên
    // văn ở trên không khớp và token đi thẳng vào thông điệp lỗi.
    const theoHinhDang = thay.replace(/\/bot\d+(?::|%3A|&#58;|&#x3a;)[A-Za-z0-9_%\-.]+/gi, "/bot<token>");
    // Lớp CỘNG THÊM (không thay lớp nào ở trên - bài học "phá code chỉ đo chiều
    // MỚI" ở CLAUDE.md): che riêng phần BÍ MẬT sau dấu hai chấm. Bắt được hai
    // ca mà lớp trên lọt: cổng dùng entity hex cho dấu hai chấm, và cổng chỉ
    // echo NỬA bí mật không kèm tiền tố `<id>:`.
    const biMat = p.token.split(":")[1];
    return biMat && biMat.length > 8 ? theoHinhDang.split(biMat).join("<token>") : theoHinhDang;
  };

  async function goi<T>(method: string, body?: unknown, hanRiengMs?: number): Promise<T> {
    // Token nằm trong ĐƯỜNG DẪN chứ không phải header (Zalo bê nguyên kiểu
    // Telegram). Hệ quả phải nhớ: mọi chỗ log lỗi PHẢI log `method` chứ tuyệt
    // đối không log URL - URL chứa token.
    const url = `${gocApi}/bot${p.token}/${method}`;

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(hanRiengMs ?? timeoutMs),
      });
    } catch (err) {
      // Bọc lại để thông điệp không mang URL. `err.message` của fetch/undici
      // có thể chèn URL vào ("fetch failed" thì không, nhưng vài nhánh có).
      const ly = err instanceof Error ? err.name : "lỗi mạng";
      throw new LoiZaloBotApi(`Không gọi được ${method}: ${ly}`, method);
    }

    const chu = await res.text();
    let phongBi: ZaloBotEnvelope<T>;
    try {
      phongBi = JSON.parse(chu) as ZaloBotEnvelope<T>;
    } catch {
      // Cắt ngắn: thân lỗi có thể là trang HTML dài của gateway.
      throw new LoiZaloBotApi(
        `${method} trả về thân không phải JSON (HTTP ${res.status}): ${che(chu.slice(0, 200))}`,
        method,
        res.status,
      );
    }

    if (!res.ok || phongBi.ok !== true) {
      // Hình dạng nhánh hỏng chưa được tài liệu hóa đầy đủ nên đọc phòng thủ
      // theo cả ba trường đã thấy trong tài liệu và các SDK khác.
      const loi =
        // `description` ĐỨNG ĐẦU: đo trên API thật, đây là trường Zalo dùng.
        (typeof phongBi.description === "string" && phongBi.description) ||
        (typeof phongBi.message === "string" && phongBi.message) ||
        (typeof phongBi.error === "string" && phongBi.error) ||
        (phongBi.error && typeof phongBi.error === "object" && "message" in phongBi.error
          ? String((phongBi.error as { message: unknown }).message)
          : "") ||
        `HTTP ${res.status}`;
      // Che cả nhánh này: Zalo hiện không echo đường dẫn, nhưng cổng trung gian
      // có thể chen vào và trả một thân JSON có mang URL.
      throw new LoiZaloBotApi(`${method} thất bại: ${che(loi)}`, method, res.status, phongBi.error_code);
    }

    return phongBi.result as T;
  }

  return {
    /** Kiểm token sống và lấy thông tin bot */
    getMe: () => goi<{ id: string; display_name?: string; account_name?: string }>("getMe"),

    /**
     * Long polling. KHÔNG có tham số `offset` như Telegram (đã tra tài liệu
     * chính thức) - server tự bóc tin khỏi hàng chờ, đọc xong là MẤT. Nghĩa là
     * tiến trình chết sau khi nhận mà chưa xử lý xong thì tin đó không lấy lại
     * được; tầng gọi phải ghi tin vào DB NGAY khi nhận, đúng như
     * `record-incoming-message.ts` đang làm cho kênh cá nhân.
     *
     * Trả về MỘT update mỗi lần gọi (hoặc null khi hết hạn chờ mà không có tin).
     */
    getUpdates: async (timeoutGiay = 30): Promise<ZaloBotUpdate | null> => {
      // Cộng biên để AbortSignal không cắt TRƯỚC khi server kịp trả lời hết hạn
      // chờ - cắt sớm là mỗi vòng poll đều tính thành lỗi mạng.
      const hanMs = timeoutGiay * 1000 + 7_000;
      try {
        const kq = await goi<ZaloBotUpdate | null>("getUpdates", { timeout: timeoutGiay }, hanMs);
        if (!kq || !kq.event_name) return null;
        return kq;
      } catch (err) {
        // HẾT HẠN CHỜ MÀ KHÔNG CÓ TIN là kết cục bình thường, KHÔNG phải lỗi.
        // Ném ra ngoài thì mọi phút im lặng đều thành một dòng log lỗi, và vòng
        // poll có backoff sẽ tự lùi mãi dù đường truyền hoàn toàn khỏe mạnh.
        // `Number(...)` chứ không so nghiêm ngặt: `error_code` khai là
        // `number | string` vì tài liệu không cam kết. Đo hiện tại ra SỐ, nhưng
        // nếu Zalo đổi sang chuỗi "408" thì phép so nghiêm ngặt trượt và MỌI
        // phút im lặng thành một dòng log lỗi kèm lùi tới 60 giây - đúng hậu
        // quả mà nhánh này sinh ra để tránh.
        if (err instanceof LoiZaloBotApi && Number(err.maLoi) === MA_LOI_HET_HAN_CHO) return null;
        throw err;
      }
    },

    /**
     * Gửi tin chữ. Mặc định `parse_mode: null` - GỬI CHỮ TRƠN.
     *
     * Bản đầu mặc định `"markdown"` kèm chú thích "để SERVER dựng định dạng".
     * Chú thích đó mô tả một luồng KHÔNG TỒN TẠI: `deliverChatReply` chạy
     * `dinhDangNeuBat` trước, và `markdownSangStyleZalo` bóc dấu ra thành
     * `Style[]` (đo: "**Bảng giá**" ra "Bảng giá" + 1 style), nên tới đây
     * không còn markdown nào để dựng - xin server dựng chỉ có thể BỚT ký tự.
     *
     * Không caller sản xuất nào dùng mặc định cũ (`kenh-bot.ts` luôn truyền
     * `null` tường minh), nhưng để mặc định sai là dựng sẵn một cái bẫy cho
     * caller tiếp theo. Muốn dò `parse_mode` thì truyền tường minh.
     */
    sendMessage: (chatId: string, text: string, parseMode: "markdown" | "html" | null = null) =>
      goi<KetQuaGuiTin>("sendMessage", {
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),

    /**
     * Gửi ảnh. `photoUrl` PHẢI là URL công khai `http(s)://` - Zalo tự đi tải
     * ảnh về từ phía server.
     *
     * Đo trên API thật, cả ba đường thay thế đều BỊ TỪ CHỐI:
     * - multipart/form-data -> "The photo must not be empty" (không parse)
     * - data URI            -> "The photo must start with http:// or https://"
     * - base64 trần         -> cùng lỗi trên
     *
     * Hệ quả cho `create_image`: ảnh bot tự vẽ KHÔNG gửi thẳng được, phải có
     * đường phục vụ nó qua HTTPS công khai trước.
     *
     * Lưu ý thêm: một số host chặn bộ tải của Zalo. Đo được `picsum.photos` và
     * `placehold.co` chạy tốt (cả jpg lẫn png), còn `upload.wikimedia.org` thì
     * trả "The photo URL is invalid" dù URL vẫn là HTTPS và mở được bằng trình duyệt.
     */
    sendPhoto: (chatId: string, photoUrl: string, caption?: string) =>
      goi<KetQuaGuiTin>("sendPhoto", {
        chat_id: chatId,
        photo: photoUrl,
        ...(caption ? { caption } : {}),
      }),

    /** Dấu "đang nhập". Zalo tự tắt sau một lúc nên phải gọi lại định kỳ. */
    sendChatAction: (chatId: string, action = "typing") =>
      goi<unknown>("sendChatAction", { chat_id: chatId, action }),

    getWebhookInfo: () => goi<{ url?: string }>("getWebhookInfo"),

    /**
     * Webhook và getUpdates LOẠI TRỪ NHAU (tài liệu ghi rõ "getUpdates sẽ không
     * hoạt động nếu trước đó đã cài Webhook"). Bot chạy long polling nên chỉ
     * cần method này để GỠ webhook thừa nếu ai đó lỡ cài.
     */
    deleteWebhook: () => goi<unknown>("deleteWebhook"),
  };
}

export type ZaloBotClient = ReturnType<typeof taoZaloBotClient>;
export type { ZaloBotMessage, ZaloBotUpdate };
