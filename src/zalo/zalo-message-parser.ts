import { ThreadType } from "zca-js";

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

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseIncomingMessage(
  accountId: string,
  selfId: string,
  message: any,
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
    const url = content.hd ?? content.href ?? content.oriUrl ?? content.normalUrl ?? content.thumb;
    if (url && msgType.includes("photo")) {
      images.push({ url: String(url) });
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
