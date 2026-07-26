import { ThreadType } from "zca-js";
import { pickImageVariant, type ImageQuality } from "./zalo-image-variant.js";

export type IncomingImage = {
  url: string;
  /** Đường dẫn file đã lưu trong data/media (tương đối với DATA_DIR) - có sau khi persist */
  localPath?: string;
};

export type ParsedMessage = {
  accountId: string;
  threadId: string;
  threadType: ThreadType;
  isGroup: boolean;
  senderId: string;
  senderName: string;
  text: string;
  images: IncomingImage[];
  msgId: string;
  cliMsgId: string;
  isSelf: boolean;
  mentionsMe: boolean;
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
  return `${msg.text}${imageNote}`.trim() || "[ảnh]";
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
): ParsedMessage {
  const data = message?.data ?? {};
  const content = data.content;
  const msgType = String(data.msgType ?? "");

  let text = "";
  const images: IncomingImage[] = [];

  if (typeof content === "string") {
    text = content;
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
    msgId: String(data.msgId ?? ""),
    cliMsgId: String(data.cliMsgId ?? ""),
    isSelf: Boolean(message?.isSelf),
    mentionsMe,
    rawData: data,
  };
}
