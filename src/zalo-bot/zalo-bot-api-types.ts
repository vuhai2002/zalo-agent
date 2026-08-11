/**
 * Kiểu dữ liệu của Zalo Bot API (`bot-api.zaloplatforms.com`).
 *
 * ĐÂY LÀ SẢN PHẨM KHÁC với Zalo OA API (`openapi.zalo.me`) - hai thứ bị nhầm
 * lẫn khắp nơi kể cả trong tài liệu bên thứ ba. Bot API sao chép hình dạng của
 * Telegram Bot API: `POST /bot{token}/{method}`, thân JSON, phong bì
 * `{ok, result}`. Chính sách "7 ngày kể từ tương tác cuối" và biểu phí gửi tin
 * là của OA API, KHÔNG áp cho đường này - đừng suy sang.
 *
 * Nguồn: https://docs.zaloplatforms.com/docs/BOT
 */

/** 5 loại sự kiện bot nhận được (tài liệu mục Webhook) */
export const LOAI_SU_KIEN = [
  "message.text.received",
  "message.image.received",
  "message.sticker.received",
  "message.voice.received",
  "message.unsupported.received",
] as const;

export type LoaiSuKien = (typeof LOAI_SU_KIEN)[number];

export type ZaloBotFrom = {
  id: string;
  display_name: string;
  is_bot: boolean;
};

export type ZaloBotChat = {
  id: string;
  /** PRIVATE = tin nhắn riêng, GROUP = nhóm (nhóm còn đang thử nghiệm nội bộ) */
  chat_type: "PRIVATE" | "GROUP";
};

export type ZaloBotMessage = {
  from: ZaloBotFrom;
  chat: ZaloBotChat;
  message_id: string;
  /** MILIGIÂY kể từ epoch - KHÔNG phải giây như Telegram */
  date: number;
  text?: string;
  /** Đường dẫn ảnh. Có tài liệu ghi `photo`, bản port của goclaw đọc cả `photo_url` */
  photo?: string;
  photo_url?: string;
  caption?: string;
  sticker?: string;
  url?: string;
  voice_url?: string;
};

export type ZaloBotUpdate = {
  event_name: LoaiSuKien | string;
  message?: ZaloBotMessage;
};

/** Phong bì chung của mọi lời gọi */
export type ZaloBotEnvelope<T> = {
  ok: boolean;
  result?: T;
  /**
   * Nhánh hỏng. ĐO TRÊN API THẬT: Zalo trả `{ok:false, description, error_code}`
   * kèm HTTP **200** - `description` mới là chỗ chứa lý do, không phải `message`
   * hay `error`. Giữ cả ba tên vì tài liệu không cam kết hình dạng này.
   *
   * Ví dụ thật: {"ok":false,"description":"Bad request: The chat_id must not be
   * empty","error_code":400} và {"ok":false,"description":"Not Found","error_code":404}
   */
  description?: string;
  error?: unknown;
  message?: string;
  error_code?: number | string;
};

export type KetQuaGuiTin = {
  message_id: string;
  date: number;
};

/**
 * Trần độ dài MỘT tin - tài liệu `sendMessage` ghi "độ dài từ 1 đến 2000 ký tự".
 * Cắt là việc của tầng gọi (`split-long-message.ts` đã có sẵn cho kênh cá nhân).
 */
export const TRAN_KY_TU_MOT_TIN = 2000;
