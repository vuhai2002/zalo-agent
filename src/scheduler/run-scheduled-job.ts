/**
 * Một lần chạy 1 job lịch hẹn: dựng input -> (agent nếu kind='agent') -> kiểm
 * [SILENT] -> guard trước khi gửi -> gửi -> ghi history + sổ chạy.
 *
 * KHÔNG retry ở tầng này: agent-loop đã có 2 tầng retry (glitch router +
 * `maxRetries` của SDK). Job lỗi thì ghi run 'error' và im - không nhắn "trục
 * trặc kỹ thuật" như lượt tin nhắn, vì ở đây không ai đang ngồi chờ để mà báo
 * (luật goclaw: chỉ output THÀNH CÔNG mới deliver).
 */

import type { API, ThreadType } from "zca-js";
import { runAgentTurn } from "../agent/agent-loop.js";
import type { StepTrace } from "../agent/agent-step-trace.js";
import { saveTurnTrace } from "../agent/agent-trace-store.js";
import type { resolveLanguageModel } from "../agent/llm-provider.js";
import { getAccount, type AccountConfig } from "../config/account-store.js";
import { env } from "../config/env.js";
import { finishAgentTurn, openAgentTurn } from "../conversation/usage-store.js";
import { createLogger } from "../shared/logger.js";
import { runInTurnLogContext } from "../shared/turn-log-context.js";
import { getRunningAccountApi } from "../zalo/account-manager.js";
import { sendReplyInParts, type ReplyTarget } from "../zalo/send-reply-in-parts.js";
import { openRun } from "./job-run-log-store.js";
import { ACCOUNT_NOT_RUNNING_REASON, enqueueProactiveSend } from "./proactive-send-guard.js";
import { blockedByGuard, conclude, finishSend } from "./scheduled-job-conclude.js";
import { buildSyntheticMessage, withLateLabel } from "./scheduled-job-prompt.js";
import type { ScheduledJob } from "./scheduled-job-store.js";
import { isSilentResponse } from "./silent-sentinel.js";

const log = createLogger("run-scheduled-job");

export type RunScheduledJobOptions = {
  /** true khi `decideDueAction` trả 'run-late' (chỉ xảy ra với schedule_kind='once') */
  late: boolean;
  /** `next_run_at` GỐC (mốc job LẼ RA phải chạy) - cho nhãn "(nhắc trễ, lịch gốc HH:MM)" */
  scheduledFor: string;
  /** Seam test - model giả cho lượt agent; mặc định `resolveLanguageModel` thật (agent-loop.ts) */
  resolveModel?: typeof resolveLanguageModel;
};

/**
 * Chạy 1 job đến hạn - KHÔNG BAO GIỜ ném lỗi ra ngoài: hàm này bị gọi KHÔNG
 * AWAIT từ vòng tick (scheduler-loop.ts, đúng bài goclaw học bằng máu), một
 * promise vỡ ở đây sẽ không có ai bắt.
 */
export async function runScheduledJob(job: ScheduledJob, options: RunScheduledJobOptions): Promise<void> {
  const runId = openRun(job.id);
  try {
    await dispatch(job, options, runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ jobId: job.id, err }, "Lỗi không lường trước khi chạy job lịch hẹn");
    conclude(job, runId, { status: "error", detail: message });
  }
}

async function dispatch(job: ScheduledJob, options: RunScheduledJobOptions, runId: number): Promise<void> {
  const timeZone = job.timezone || env.BOT_TIMEZONE;
  // Account KHÔNG CHẠY thì dừng NGAY - trước cả khi mở lượt agent, tránh tốn
  // token cho một lượt chắc chắn không gửi được gì.
  const account = getAccount(job.accountId);
  const api = getRunningAccountApi(job.accountId);
  if (!account || !api) {
    conclude(job, runId, { status: "skipped", detail: ACCOUNT_NOT_RUNNING_REASON });
    return;
  }

  const target: ReplyTarget = {
    api,
    threadKey: `${job.accountId}:${job.threadId}`,
    threadId: job.threadId,
    threadType: job.threadType as ThreadType,
  };

  if (job.kind === "message") {
    await runMessageJob(job, target, runId, timeZone, options);
    return;
  }
  await runAgentJob(job, account, api, target, runId, timeZone, options);
}

/** kind='message': 0 token, gửi thẳng nguyên văn payload - không chạm LLM */
async function runMessageJob(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  options: RunScheduledJobOptions,
): Promise<void> {
  if (await blockedByGuard(job, target, runId, timeZone)) return;

  const text = options.late ? withLateLabel(job.payload, options.scheduledFor, timeZone) : job.payload;
  const reply = await enqueueProactiveSend(() => sendReplyInParts(target, text));
  finishSend(job, runId, timeZone, reply);
}

/** kind='agent': lượt agent CÔ LẬP (isolated:true) rồi mới xét gửi hay im */
async function runAgentJob(
  job: ScheduledJob,
  account: AccountConfig,
  api: API,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  options: RunScheduledJobOptions,
): Promise<void> {
  const message = buildSyntheticMessage(job);
  const trace: StepTrace[] = [];
  const turnId = openAgentTurn(job.accountId, job.threadId, "schedule");

  await runInTurnLogContext({ accountId: job.accountId, threadId: job.threadId, turnId }, async () => {
    try {
      const result = await runAgentTurn({
        api,
        account,
        batch: [message],
        trace,
        isolated: true,
        resolveModel: options.resolveModel,
      });
      finishAgentTurn(turnId, result.usage);
      if (trace.length > 0) saveTurnTrace(turnId, trace);

      const text = result.text.trim();
      if (!text || isSilentResponse(text)) {
        conclude(job, runId, {
          status: "silent",
          turnId,
          detail: text ? "Agent trả [SILENT] - không có gì mới để báo." : "Agent không trả nội dung.",
        });
        return;
      }

      if (await blockedByGuard(job, target, runId, timeZone, turnId)) return;

      const finalText = options.late ? withLateLabel(text, options.scheduledFor, timeZone) : text;
      const reply = await enqueueProactiveSend(() => sendReplyInParts(target, finalText));
      finishSend(job, runId, timeZone, reply, turnId);
    } catch (err) {
      // Lượt ném lỗi (provider chết, timeout...) vẫn phải chốt token đã tốn +
      // lưu trace các step ĐÃ chạy được - đúng nếp message-turn-processor.ts.
      // Khác duy nhất: KHÔNG nhắn "trục trặc kỹ thuật" - job lỗi thì im.
      finishAgentTurn(turnId, { inputTokens: 0, outputTokens: 0, totalTokens: 0, steps: trace.length });
      if (trace.length > 0) saveTurnTrace(turnId, trace);
      const message = err instanceof Error ? err.message : String(err);
      conclude(job, runId, { status: "error", turnId, detail: message });
    }
  });
}
