import { ThreadType } from "zca-js";
import { pickImageVariant, type ImageQuality } from "./zalo-image-variant.js";
import { lamSachTenTep } from "../attachments/ten-tep-an-toan.js";
import { mocGuiCuaTinZalo } from "./zalo-message-timestamp.js";

export type IncomingImage = {
  url: string;
  /** Đường dẫn file đã lưu trong data/media (tương đối với DATA_DIR) - có sau khi persist */
  localPath?: string;
};

/**
 * Tệp đính kèm của tin `share.file`. `href`/`duoiKhai`/`coKhai` do client NGƯỜI
 * GỬI tự khai (zca-js `sendMessage.ts`) - coi như dữ liệu không tin được: trần
 * byte đếm trên byte thật, loại tệp nhận bằng byte thật.
 */
export type IncomingFile = { href: string; ten: string; duoiKhai: string; coKhai: number | null };

export type ParsedMessage = {
  accountId: string;
  threadId: string;
  threadType: ThreadType;
  isGroup: boolean;
  senderId: string;
  senderName: string;
  text: string;
  images: IncomingImage[];
  /**
   * Tệp đính kèm (`share.file`). TÙY CHỌN để hàng trăm fixture `ParsedMessage`
   * trong test cũ không phải sửa; `parseIncomingMessage` LUÔN gán (rỗng khi
   * không có), chỗ đọc dùng `msg.files ?? []`.
   */
  files?: IncomingFile[];
  msgId: string;
  cliMsgId: string;
  isSelf: boolean;
  mentionsMe: boolean;
  /**
   * ISO UTC - giờ NGƯỜI TA GỬI, đọc từ `data.ts` (xem `zalo-message-timestamp.ts`).
   *
   * Đây là mốc giờ DUY NHẤT của tin này: nó vừa được ghi vào `created_at` lúc
   * lưu history, vừa là nhãn `[dd/mm hh:mm]` mà model đọc. Một nguồn nên hai
   * chỗ không thể lệch nhau - trước đây `created_at` là giờ KẾT THÚC lượt nên
   * lượt dài làm nhãn lệch mấy phút so với lúc bấm gửi.
   */
  sentAt: string;
  /**
   * Tin tới từ hàng chờ LẤY BÙ của Zalo (cmd 510/511) chứ không phải tin trực
   * tiếp - tin người ta gửi lúc bot không nghe. Lượt có tin này mà trễ quá ngưỡng
   * thì mở đầu bằng một câu xin lỗi vì trả lời muộn. Xem `src/zalo/offline-replay/`.
   */
  layBu?: true;
  /**
   * Tin lấy bù trễ từ ngưỡng xin lỗi (`LAY_BU_NGUONG_XIN_LOI_PHUT`): dòng của nó
   * (lịch sử + lượt hiện tại) mang nhãn "hệ thống gián đoạn". Chốt MỘT lần lúc
   * nhận, tách khỏi `layBu`: chớp mạng vài phút thì không kể chuyện gián đoạn, và
   * `layBu` còn bị gỡ khi người đó nhắn lại (không xin lỗi) trong khi dòng lịch sử
   * đã ghi cờ - hai nơi đọc hai trường khác nhau là lệch nhau.
   */
  denTre?: true;
  /**
   * id dòng trong bảng `messages`, đóng dấu bởi `ghiTinDenVaoHistory` ngay lúc
   * nhận tin. Chưa ghi thì chưa có.
   *
   * Lượt agent dùng nó để LỌC chính tin của mình ra khỏi phần lịch sử: từ khi
   * tin được ghi lúc nhận (thay vì cuối lượt), lúc lượt đọc lịch sử thì tin của
   * nó đã nằm sẵn trong đó - không lọc là model thấy lặp hai lần.
   */
  historyRowId?: number;
  /**
   * id các dòng `tep_dinh_kem` của tin này, đóng dấu cùng lúc với
   * `historyRowId` - router dùng để tải sớm khi tin gọi bot.
   */
  tepIds?: number[];
  /** data gốc của zca-js - dùng cho quote khi trả lời */
  rawData: Record<string, unknown>;
};

/**
 * Nội dung ghi vào history cho 1 tin đến. Ảnh không vào được cột text nên để
 * lại dấu vết đếm được; tin chỉ có ảnh vẫn phải có chữ, nếu không lượt sau
 * model đọc history thấy một dòng trống không hiểu chuyện gì đã xảy ra.
 */
export function describeForHistory(msg: ParsedMessage): string {
  const imageNote = msg.images.length > 0 ? ` [gửi kèm ${msg.images.length} ảnh]` : "";
  return `${msg.text}${imageNote}${ghiChuTep(msg)}`.trim() || "[ảnh]";
}

/**
 * Thẻ tệp đính kèm ghép vào dòng tin - DÙNG CHUNG cho dòng lịch sử và dòng của
 * lượt hiện tại để cùng một tin render y hệt ở cả hai nơi. Tên tệp (của người
 * lạ) đã làm sạch và nằm trong ngoặc kép JSON, bên trong chính dòng của người
 * gửi - không thành một nhãn đứng riêng kiểu bot viết.
 */
export function ghiChuTep(msg: Pick<ParsedMessage, "files">): string {
  return (msg.files ?? []).map((f) => ` [tệp đính kèm ${JSON.stringify(f.ten)}]`).join("");
}

const DUOI_ANH = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function docParams(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

/** Cỡ khai trong `params.fileSize` - chuỗi ở đa số tin, SỐ ở một số tin (đo trên dữ liệu thật) */
function coKhaiCua(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @param imageQuality cỡ ảnh lấy từ payload Zalo - caller truyền
 * env.ZALO_IMAGE_QUALITY vào để module này thuần, test khỏi cần setupTestEnv
 * (cùng lý do với `botEnabledForThread` của allowlist-filter).
 */
export function parseIncomingMessage(
  accountId: string,
  selfId: string,
  message: any,
  imageQuality: ImageQuality = "normal",
  nhanLuc: Date = new Date(),
): ParsedMessage {
  const data = message?.data ?? {};
  const content = data.content;
  const msgType = String(data.msgType ?? "");

  let text = "";
  const images: IncomingImage[] = [];
  const files: IncomingFile[] = [];

  if (typeof content === "string") {
    text = content;
  } else if (msgType === "share.file" && content && typeof content === "object") {
    // CHỈ share.file - share.link cũng mang href nhưng là đường link, không phải tệp
    const c = content as Record<string, unknown>;
    const href = typeof c.href === "string" ? c.href : "";
    const tenGoc = String(c.title ?? "");
    const params = docParams(c.params);
    const duoiKhai = String(params.fileExt ?? /\.([A-Za-z0-9]{1,8})$/.exec(tenGoc)?.[1] ?? "").toLowerCase();
    text = String(c.description ?? "");
    if (href && DUOI_ANH.has(duoiKhai)) {
      // Ảnh gửi dạng tệp (cho khỏi bể nét) đi đường ảnh có sẵn
      images.push({ url: href });
    } else if (href) {
      files.push({ href, ten: lamSachTenTep(tenGoc), duoiKhai, coKhai: coKhaiCua(params.fileSize) });
    }
  } else if (content && typeof content === "object") {
    // Tin nhắn media: content là object có href/thumb + title (caption)
    text = String(content.title ?? content.description ?? "");
    // Zalo gửi kèm nhiều cỡ của cùng 1 ảnh. Lấy `hd` (bản to nhất) là tốn
    // token vô ích: ảnh HD 977x2128 ~2500 token mỗi lần vào context.
    const picked = msgType.includes("photo")
      ? pickImageVariant(content as Record<string, unknown>, imageQuality)
      : null;
    if (picked) {
      images.push({ url: picked.url });
    }
  }

  const mentions = Array.isArray(data.mentions) ? data.mentions : [];
  const mentionsMe = mentions.some((m: any) => String(m?.uid) === selfId);

  return {
    accountId,
    threadId: String(message?.threadId ?? ""),
    threadType: message?.type ?? ThreadType.User,
    isGroup: message?.type === ThreadType.Group,
    senderId: String(data.uidFrom ?? ""),
    senderName: String(data.dName ?? "Người dùng"),
    text,
    images,
    files,
    msgId: String(data.msgId ?? ""),
    cliMsgId: String(data.cliMsgId ?? ""),
    isSelf: Boolean(message?.isSelf),
    mentionsMe,
    sentAt: mocGuiCuaTinZalo(data.ts, nhanLuc),
    rawData: data,
  };
}
