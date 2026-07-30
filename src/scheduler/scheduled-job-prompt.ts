/**
 * Xây "input" cho lượt agent theo lịch: `ParsedMessage` tổng hợp (không có tin
 * thật nào kích hoạt lượt này) + nhãn "nhắc trễ" khi job chạy chậm quá grace.
 * Tách khỏi `run-scheduled-job.ts` để file đó không vượt ngưỡng 200 dòng.
 */

import { DateTime } from "luxon";
import { ThreadType } from "zca-js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import type { ScheduledJob } from "./scheduled-job-store.js";

/** Chưng cất `cron_hint` của Hermes - dạy model 3 điều lượt theo lịch khác lượt chat thường */
const CRON_HINT = `[Đây là lượt CHẠY THEO LỊCH, không phải người dùng vừa nhắn.
GỬI: câu trả lời cuối của bạn được gửi thẳng cho người dùng - không cần gọi tool gửi tin, cứ viết ra là xong.
IM LẶNG: nếu thật sự không có gì mới để báo, trả lời đúng [SILENT] và không gì khác. Tuyệt đối không vừa [SILENT] vừa kèm nội dung.
KHÔNG HỎI LẠI: không có ai đang ngồi chờ để trả lời câu hỏi của bạn.]`;

/**
 * `ParsedMessage` TỔNG HỢP cho lượt agent theo lịch - không có tin thật nào
 * kích hoạt lượt này. `msgId`/`cliMsgId` RỖNG có chủ đích: đây chính là lý do
 * `add_reaction` bị loại khỏi lượt theo lịch (`tool-registry.ts`) - không có
 * tin thật để mà thả reaction vào.
 */
export function buildSyntheticMessage(job: ScheduledJob): ParsedMessage {
  const isGroup = job.threadType === ThreadType.Group;
  return {
    accountId: job.accountId,
    threadId: job.threadId,
    threadType: job.threadType as ThreadType,
    isGroup,
    senderId: job.createdBy,
    senderName: "Lịch hẹn",
    text: `${CRON_HINT}\n\n${job.payload}`,
    images: [],
    msgId: "",
    cliMsgId: "",
    isSelf: false,
    mentionsMe: false,
    rawData: {},
  };
}

/**
 * Tiền tố "(nhắc trễ, lịch gốc HH:MM)" cho job trễ quá cửa sổ grace
 * (`decideDueAction` trả 'run-late', chỉ xảy ra với `schedule_kind='once'`).
 */
export function withLateLabel(text: string, scheduledForUtc: string, timeZone: string): string {
  const hhmm = DateTime.fromISO(scheduledForUtc, { zone: "utc" }).setZone(timeZone).toFormat("HH:mm");
  return `(nhắc trễ, lịch gốc ${hhmm}) ${text}`;
}
