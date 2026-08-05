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
import { botTimeZone } from "../config/runtime-tuning-settings.js";
import { finishAgentTurn, openAgentTurn } from "../conversation/usage-store.js";
import { createLogger } from "../shared/logger.js";
import { runInTurnLogContext } from "../shared/turn-log-context.js";
import { getRunningAccountApi } from "../zalo/account-manager.js";
import type { ReplyTarget } from "../zalo/send-reply-in-parts.js";
import { openRun } from "./job-run-log-store.js";
import { ACCOUNT_NOT_RUNNING_REASON } from "./proactive-send-guard.js";
import { concludeBlockedNotRun, concludeDeliveryFailed, conclude } from "./scheduled-job-conclude.js";
import { buildSyntheticMessage, withLateLabel } from "./scheduled-job-prompt.js";
import { blockedByGuard, sendAndConclude } from "./scheduled-job-send.js";
import type { ScheduledJob } from "./scheduled-job-store.js";
import { isSilentResponse } from "./silent-sentinel.js";
import { phanLoaiLoiProvider } from "../agent/provider-error-classifier.js";
import { lamSachTheoCauHinh } from "../zalo/prepare-outgoing-text.js";

const log = createLogger("run-scheduled-job");

export type RunScheduledJobOptions = {
  /** true khi `decideDueAction` trả 'run-late' (chỉ xảy ra với schedule_kind='once') */
  late: boolean;
  /** `next_run_at` GỐC (mốc job LẼ RA phải chạy) - cho nhãn "(nhắc trễ, lịch gốc HH:MM)" VÀ để phục hồi khi bị chặn (xem concludeBlockedNotRun) */
  scheduledFor: string;
  /**
   * Mốc thời gian của LƯỢT XỬ LÝ NÀY - chốt ở đầu tick, dùng chung cho mọi sổ
   * sách trần ngày (giành suất, hoàn suất, cộng đếm, quyền báo trần).
   *
   * BẮT BUỘC, cố ý không cho mặc định `new Date()`: giành suất và hoàn suất
   * cách nhau cả quãng gửi (20 giây `SCHEDULER_SEND_GAP_MS`, job agent thì vài
   * phút). Mỗi bên tự lấy giờ thật thì nửa đêm rơi vào giữa là giành suất ngày
   * D còn hoàn suất trả cho ngày D+1 - ngày D giữ suất vĩnh viễn. Xem khối chú
   * thích đầu `proactive-send-guard.ts`.
   */
  now: Date;
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

    // Bot CHƯA CẤU HÌNH XONG là trạng thái riêng, không phải "gửi hỏng".
    //
    // Từ khi `.env` chỉ còn một biến bắt buộc, bot khởi động được khi chưa nhập
    // API key/model - và ở trạng thái đó `resolveLanguageModel` ném mỗi lượt.
    // Đi vào `concludeDeliveryFailed` thì mỗi tick cộng một `delivery_attempts`,
    // tới lần thứ ba là `markRun` và job `once` MẤT SUẤT CHẠY VĨNH VIỄN - chỉ vì
    // người dùng chưa kịp vào dashboard nhập key.
    //
    // Cùng luật với "account chưa chạy": giữ nguyên suất, phục hồi `next_run_at`,
    // không đếm là gửi hỏng. Bất biến đã chốt: một lời nhắc chưa từng gửi được
    // thì không bao giờ được coi là đã chạy.
    if (phanLoaiLoiProvider(err) === "cau_hinh") {
      concludeBlockedNotRun(job, runId, "Bot chưa cấu hình xong LLM - chưa chạy được.", options.scheduledFor);
      return;
    }

    // Lưới đỡ NGOÀI CÙNG - không biết chắc đã gửi được gì chưa lúc lỗi bắn ra
    // tới đây, coi như "chưa gửi được" (Finding 1): đếm vào delivery_attempts
    // thay vì markRun ngay, tránh giết job chỉ vì 1 lỗi bất ngờ thoáng qua.
    concludeDeliveryFailed(job, runId, options.scheduledFor, message);
  }
}

async function dispatch(job: ScheduledJob, options: RunScheduledJobOptions, runId: number): Promise<void> {
  const timeZone = job.timezone || botTimeZone();
  // Account KHÔNG CHẠY thì dừng NGAY - trước cả khi mở lượt agent, tránh tốn
  // token cho một lượt chắc chắn không gửi được gì. `scheduler-loop.ts` đã
  // kiểm phần này TRƯỚC clear-before-dispatch nên nhánh này giờ chỉ còn là
  // lưới đỡ cho ca hiếm (account rớt phiên giữa lúc job đang xếp hàng dispatch).
  // Chặn ở đây thì KHÔNG markRun - job chưa từng chạy thật sự.
  const account = getAccount(job.accountId);
  const api = getRunningAccountApi(job.accountId);
  if (!account || !api) {
    concludeBlockedNotRun(job, runId, ACCOUNT_NOT_RUNNING_REASON, options.scheduledFor);
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
  if (await blockedByGuard(job, target, runId, timeZone, options.scheduledFor, options.now)) return;

  // `payload` là chữ MODEL viết lúc đặt lịch (qua tool `schedule_task`), và
  // lượt đặt lịch đó hoàn toàn có thể đã đọc nội dung web hay tin của người lạ.
  // Gửi nguyên văn lúc tới giờ nghĩa là nó phải qua lớp làm sạch như mọi chữ
  // khác của model.
  //
  // TUYỆT ĐỐI KHÔNG lùi về bản THÔ khi bộ lọc bắn. Bản trước viết
  // `sach.chan ? job.payload : sach.text || job.payload` - tức đúng lúc bộ canh
  // phát hiện rò system prompt thì lại gửi ĐÚNG chuỗi đó xuống Zalo, biến đường
  // này thành lối duy nhất trong repo đẩy được chữ dạng system prompt ra ngoài.
  //
  // Theo đúng nếp `redact_sensitive_text` của Hermes (`cron/scheduler.py`):
  // "Redact secrets from both stdout and stderr BEFORE ANY RETURN PATH", và khi
  // chính bộ lọc hỏng thì họ trả `"[REDACTED - redaction failed]"` chứ không bao
  // giờ trả chuỗi gốc. Ở đây tương đương: bị chặn thì KHÔNG gửi.
  //
  // Không gửi KHÁC với giết lịch hẹn: `concludeBlockedNotRun` giữ nguyên suất
  // chạy và phục hồi `next_run_at` cho job `once`, nên người dùng sửa lại nội
  // dung là lịch chạy tiếp - đúng bất biến "một lời nhắc chưa từng gửi được thì
  // không bao giờ được coi là đã chạy".
  const sach = lamSachTheoCauHinh(job.payload);
  if (sach.chan || !sach.text.trim()) {
    log.error(
      { jobId: job.id, chan: sach.chan, dauText: job.payload.slice(0, 200) },
      "Nội dung lịch hẹn không qua được lớp làm sạch - KHÔNG gửi",
    );
    concludeBlockedNotRun(
      job,
      runId,
      sach.chan
        ? "Nội dung lịch hẹn có dấu hiệu lộ chỉ dẫn nội bộ - đã chặn, chưa gửi."
        : "Nội dung lịch hẹn rỗng sau khi làm sạch - chưa gửi.",
      options.scheduledFor,
    );
    return;
  }
  if (sach.daSua.length > 0) {
    log.warn({ jobId: job.id, daSua: sach.daSua }, "Đã làm sạch payload lịch hẹn trước khi gửi");
  }

  const text = options.late
    ? withLateLabel(sach.text, options.scheduledFor, timeZone)
    : sach.text;
  await sendAndConclude(job, target, runId, timeZone, text, options.scheduledFor, options.now);
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
  // Đánh dấu ĐÃ chốt usage THẬT (result.usage) - nếu catch bên dưới bắt được
  // lỗi ném ra SAU điểm đó (vd blockedByGuard/sendAndConclude ném lỗi hiếm),
  // KHÔNG được gọi lại finishAgentTurn/saveTurnTrace lần 2: lần 2 dùng usage
  // {0,0,0} giả, ĐÈ MẤT số token thật vừa ghi đúng, và saveTurnTrace lần 2
  // chèn TRÙNG y hệt các dòng agent_steps đã lưu ở lần đầu (Mục 4, vòng 3).
  let turnFinished = false;

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
      turnFinished = true;

      const text = result.text.trim();
      if (!text || isSilentResponse(text)) {
        conclude(job, runId, {
          status: "silent",
          turnId,
          detail: text ? "Agent trả [SILENT] - không có gì mới để báo." : "Agent không trả nội dung.",
        });
        return;
      }

      // Làm sạch SAU nhánh [SILENT] ở trên: chạy trước thì bộ lọc bỏ mất chính
      // cái nhãn mà nhánh đó dựa vào để quyết im lặng, và job "không có gì mới"
      // sẽ nhắn mỗi sáng đúng thứ nó sinh ra để tránh.
      const sach = lamSachTheoCauHinh(text);
      if (sach.chan) {
        // Lượt theo lịch KHÔNG nhắn câu lỗi (job hỏng thì im - đúng nếp nhánh
        // catch bên dưới), nhưng phải chốt run 'error' để dashboard thấy.
        //
        // CỐ Ý dùng `conclude` (có `markRun`) chứ không `concludeBlockedNotRun`,
        // dù việc này tiêu suất chạy của job `once`. Lý do: rò prompt KHÔNG phải
        // sự cố thoáng qua như account rớt phiên - nó do chính payload của job
        // dẫn model tới đó, nên lượt sau gần như chắc chắn rò lại.
        // `concludeBlockedNotRun` phục hồi `next_run_at` về đúng mốc cũ, mà mốc
        // cũ thì đã quá hạn - job `once` sẽ due lại ngay tick sau và quay vòng
        // vô tận. Thà chốt lỗi một lần rồi để người dùng nhìn thấy trên dashboard
        // mà sửa payload.
        log.error({ jobId: job.id, dauText: text.slice(0, 200) }, "Chặn câu trả lời rò system prompt");
        conclude(job, runId, { status: "error", turnId, detail: "Câu trả lời rò system prompt - đã chặn." });
        return;
      }
      if (sach.daSua.length > 0) {
        log.warn({ jobId: job.id, daSua: sach.daSua }, "Đã làm sạch câu trả lời của job trước khi gửi");
      }
      if (!sach.text.trim()) {
        conclude(job, runId, { status: "silent", turnId, detail: "Không còn nội dung sau khi làm sạch." });
        return;
      }

      if (await blockedByGuard(job, target, runId, timeZone, options.scheduledFor, options.now, turnId)) return;

      // Nhãn "nhắc trễ" ghép SAU khi làm sạch: nó là chữ của mình, không phải
      // của model, nên không có gì để lọc và cũng không được để lọt qua bộ lọc
      const finalText = options.late
        ? withLateLabel(sach.text, options.scheduledFor, timeZone)
        : sach.text;
      await sendAndConclude(job, target, runId, timeZone, finalText, options.scheduledFor, options.now, turnId);
    } catch (err) {
      // Lượt ném lỗi (provider chết, timeout...) vẫn phải chốt token đã tốn +
      // lưu trace các step ĐÃ chạy được - đúng nếp message-turn-processor.ts.
      // Khác duy nhất: KHÔNG nhắn "trục trặc kỹ thuật" - job lỗi thì im.
      // CHỈ chốt bằng usage {0,0,0} khi CHƯA từng chốt thật (turnFinished
      // false) - agent-loop ném lỗi TRƯỚC khi kịp trả về result là ca DUY
      // NHẤT còn lại sau khi sendAndConclude tự lo hết bookkeeping của nó
      // (Mục 2, vòng 3: sendAndConclude không còn ném lỗi sau khi đã gửi).
      if (!turnFinished) {
        finishAgentTurn(turnId, { inputTokens: 0, outputTokens: 0, totalTokens: 0, steps: trace.length });
        if (trace.length > 0) saveTurnTrace(turnId, trace);
      }
      // Chắc chắn "chưa gửi được" gì - đếm vào delivery_attempts (Finding 1)
      // thay vì markRun ngay.
      const message = err instanceof Error ? err.message : String(err);
      concludeDeliveryFailed(job, runId, options.scheduledFor, message, turnId);
    }
  });
}
