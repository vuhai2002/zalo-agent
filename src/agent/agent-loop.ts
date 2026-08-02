import { generateText, stepCountIs, type ModelMessage } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { getAgentForAccount } from "../config/agent-store.js";
import { isSidecarConfigured } from "../config/runtime-vision-settings.js";
import { getRecentMessages } from "../conversation/history-store.js";
import { getMemoriesForContext } from "../conversation/memory-store.js";
import { getThreadSummary } from "../conversation/thread-store.js";
import { createLogger } from "../shared/logger.js";
import { TECHNICAL_ERROR_REPLY } from "../zalo/send-reply-in-parts.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { summarizeStep, type StepTrace } from "./agent-step-trace.js";
import { buildTurnMessages, type ImageContextMode } from "./agent-turn-content.js";
import { resolveLanguageModel, resolveReasoningEffort, resolveReasoningOptions } from "./llm-provider.js";
import { markModelNoVision } from "./model-vision-detection.js";
import { buildSystemPrompt } from "./persona-prompt.js";
import { buildAgentTools, TOOL_DEFINITIONS } from "./tools/index.js";
import { forLog, taoQuanSatStep } from "./agent-step-observer.js";
import { nguongTheoTranStep, ToolLoopGuard } from "./tool-loop-guard.js";
import { hasImageParts, isImageRejectionError } from "./vision-rejection-fallback.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import {
  nganSachAnToan,
  soSanhUocLuong,
  TOKEN_MOI_ANH_THEO_CO,
  uocLuongTokenTinNhan,
} from "./token-estimate.js";
import { catNguCanhTheoNganSach } from "./trim-context-to-budget.js";
import { giayChoLai, maHttpCua, phanLoaiLoiProvider } from "./provider-error-classifier.js";
import {
  canLuotChot,
  hitStepLimit,
  nhanLyDoDung,
  isEmptyRouterCompletion,
  vuotTranToken,
} from "./agent-loop-conditions.js";

// Re-export để test và mọi call site cũ vẫn import từ "agent-loop.js" như trước
export { canLuotChot, hitStepLimit, isEmptyRouterCompletion, nhanLyDoDung, vuotTranToken };

const log = createLogger("agent-loop");

/**
 * Tin nhắn khi router hỏng cả 2 lần - im lặng bỏ treo người nhắn là tệ nhất.
 * Dùng chung một câu với nhánh lỗi ở account-manager để người nhắn không phải
 * đoán xem hai thông báo khác nhau nghĩa là hai chuyện khác nhau.
 */
const ROUTER_DOWN_REPLY = TECHNICAL_ERROR_REPLY;

/**
 * Dùng khi hết step VÀ lượt chốt cũng không ra chữ. Nói thật là chưa xong thay
 * vì im lặng hoặc gửi câu tường thuật nội bộ - người nhắn còn biết mà hỏi lại.
 */
const STEP_LIMIT_REPLY =
  "Mình tra hơi nhiều bước mà vẫn chưa gom đủ để trả lời cho chắc. Anh/chị hỏi lại gọn hơn một chút giúp mình nhé, ví dụ chỉ một mục hoặc một nguồn thôi.";

export type AgentTurnParams = {
  api: API;
  account: AccountConfig;
  /** Các tin nhắn đã gộp của lượt này (ảnh và caption Zalo gửi tách nhau) */
  batch: ParsedMessage[];
  /**
   * Mảng trace do CALLER sở hữu, hàm này chỉ push vào.
   *
   * Trước đây mảng này là biến cục bộ rồi trả về ở cuối - nghĩa là lượt ném lỗi
   * làm nó rơi theo stack, mất sạch phần chẩn đoán đúng lúc cần nhất. Caller giữ
   * mảng thì nhánh catch vẫn còn đủ những gì đã chạy được.
   */
  trace: StepTrace[];
  /**
   * Điểm tiêm model, chỉ test truyền vào (mặc định là `resolveLanguageModel`).
   * Cùng nếp đã dùng ở `persistBatchImages` (tiêm downloader) và
   * `web-search-providers` (tiêm fetch): không có seam này thì mọi nhánh của
   * vòng lặp - retry, bỏ pixel, lượt chốt - đều phải gọi provider thật để test.
   */
  resolveModel?: typeof resolveLanguageModel;
  /**
   * Lượt CHẠY THEO LỊCH (job scheduler), không phải người dùng vừa nhắn - bỏ
   * qua history/memory/summary, coi như 1 phiên hoàn toàn cô lập. Mặc định
   * false để lượt tin nhắn thường không đổi hành vi. Persona GIỮ NGUYÊN (không
   * cô lập) - bot vẫn phải biết mình là ai và làm được gì.
   *
   * Vào input thì cô lập, ra output thì ghi history: hàm này chỉ lo phần
   * INPUT; ghi câu trả lời vào history là việc của caller (run-scheduled-job.ts),
   * đúng nếp message-turn-processor.ts đang làm cho lượt tin nhắn.
   */
  isolated?: boolean;
};

export type AgentTurnResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; steps: number };
};

/**
 * Chạy 1 lượt agent: history + cả batch tin nhắn mới (kèm ảnh nếu có) -> LLM tự
 * quyết gọi tool (react, gửi file, tag...) -> trả text cuối cùng để gửi lại Zalo.
 *
 * History được đọc TRƯỚC khi ghi batch hiện tại vào DB, nếu không tin nhắn mới
 * sẽ xuất hiện 2 lần trong input của model.
 */
export async function runAgentTurn({
  api,
  account,
  batch,
  trace,
  resolveModel = resolveLanguageModel,
  isolated = false,
}: AgentTurnParams): Promise<AgentTurnResult> {
  // Tin cuối đại diện cho lượt: tools (thả reaction, quote) tác động lên tin này
  const latest = batch[batch.length - 1]!;

  // Não của account: persona + model/maxSteps override (fallback cấu hình chung)
  const agent = getAgentForAccount(account.agentId);

  // Phiên cô lập: KHÔNG gọi getRecentMessages/getMemoriesForContext/getThreadSummary
  // (không chỉ bỏ qua kết quả) - job lịch hẹn không được đọc hội thoại đang có
  // của thread, tránh trộn ngữ cảnh giữa "user đang nói chuyện gì" với "job tự
  // báo cáo lúc 3 giờ sáng".
  const history = isolated ? [] : getRecentMessages(account.id, latest.threadId);
  // Ảnh xử lý theo chế độ: native (model tự đọc) / describe (sidecar mô tả) /
  // hybrid (combo: cả hai) / blind (bỏ ảnh, dặn bot nói thật)
  // Trần token hiệu lực: agent đặt riêng thắng cấu hình chung - cùng nếp với
  // maxSteps và reasoningEffort. Ở agent vì trần phụ thuộc cửa sổ của MODEL.
  const tranToken = agent.contextWindow ?? getTuning("LLM_CONTEXT_WINDOW");
  // Tính MỘT LẦN ở đây rồi dùng chung cho `stopWhen`, ngưỡng guard và log lý do
  // dừng: ba chỗ đó phải nói về cùng một con số, mà trước đây mỗi chỗ tự đọc lại
  // `agent.maxSteps ?? getTuning(...)`.
  const tranStep = agent.maxSteps ?? getTuning("LLM_MAX_STEPS");

  const built = await buildTurnMessages({
    history,
    batch,
    override: agent,
    allowlist: account.allowlist,
    tranToken,
  });
  let messages = built.messages;
  let imageMode = built.imageMode;
  if (built.daCat) {
    log.warn(
      { ...built.daCat, tranToken },
      "Ngữ cảnh vượt ngân sách token - đã cắt bớt trước khi gọi model",
    );
  }

  // Memory: fact bền (lọc theo quy tắc privacy) + summary phần hội thoại cũ
  const memory = isolated
    ? { facts: [], threadSummary: "" }
    : {
        facts: getMemoriesForContext({
          accountId: account.id,
          threadId: latest.threadId,
          senderId: latest.senderId,
          isGroup: latest.isGroup,
        }),
        threadSummary: getThreadSummary(account.id, latest.threadId).summary,
      };

  // `trace` do caller truyền vào và dùng chung cho MỌI lần chạy trong lượt: lượt
  // retry (glitch router) và lượt dựng lại không kèm pixel đều nối tiếp vào đó -
  // đúng lúc hỏng mới cần nhìn đủ cả hai lần chạy.
  //
  // Mỗi lần chạy đánh số step lại từ 1, nên phải ghi kèm LẦN CHẠY: không có nó
  // thì trace xếp ra 1,1,2,2,3,3 và đọc y hệt model đang lặp vô hạn.
  let lanChay = 1;

  /**
   * Chống vòng lặp tool. Dựng MỘT lần cho cả lượt nhưng `datLai()` mỗi khi
   * `lanChay++` (retry completion rỗng, dựng lại input không kèm pixel) - lần
   * chạy mới là ngữ cảnh mới, không được mang tội của lần trước sang.
   *
   * Biến CỤC BỘ trong hàm này, không phải module scope: nhiều thread chạy song
   * song thì mỗi lượt phải có bộ đếm riêng.
   *
   * `group === "read"` của catalog chính là tập tool chỉ đọc - dùng luôn thay vì
   * viết danh sách thứ hai rồi để nó trôi khỏi catalog.
   */
  const guard = new ToolLoopGuard(
    nguongTheoTranStep(
      {
        chanLoiGiongHet: getTuning("TOOL_LOOP_SAME_ARGS_BLOCK"),
        chanCungToolLoi: getTuning("TOOL_LOOP_SAME_TOOL_BLOCK"),
        chanKhongTienTrien: getTuning("TOOL_LOOP_NO_PROGRESS_BLOCK"),
      },
      tranStep,
    ),
    (ten) => TOOL_DEFINITIONS.find((d) => d.key === ten)?.group === "read",
  );

  // `layLanChay` là HÀM chứ không phải số: `lanChay` tăng lên giữa lượt, truyền
  // giá trị là trace của các lần chạy sau bị đánh nhãn của lần đầu.
  const quanSatStep = taoQuanSatStep({ guard, trace, layLanChay: () => lanChay });

  const runOnce = () =>
    generateText({
      model: resolveModel(agent, {
        accountId: account.id,
        threadId: latest.threadId,
      }),
      system: buildSystemPrompt(agent, latest, memory, account, isolated),
      messages,
      // Hai lớp lọc tool giao nhau: agent khai năng lực, account áp chính sách.
      // Thêm `isolated` lọc bớt tool không hợp với lượt theo lịch (add_reaction
      // không có msgId thật, read_image không có ảnh, save_memory chặn injection
      // từ job) - xem runsInScheduledTurn ở tool-registry.ts
      tools: buildAgentTools({ api, account, agent, message: latest, batch, isolated }),
      // Hai điều kiện dừng. `stepCountIs` chặn số VÒNG; điều kiện token chặn
      // KÍCH THƯỚC - kết quả tool cộng dồn qua từng step (web_fetch một mình đã
      // tới WEB_FETCH_MAX_CHARS ký tự), nên một lượt ít step vẫn phình được.
      // Đo trên DB thật: đã có lượt cộng dồn 184.835 token qua 8 step.
      // Dùng ĐÚNG ngân sách đã trừ hao như lúc cắt ngữ cảnh, không phải trần
      // thô. So với trần thô thì điều kiện này gần như không bao giờ chạy:
      // provider trả 400 trước khi usage của lần gọi đó kịp về, nên hàm chưa
      // từng được gọi với con số vượt.
      stopWhen: [
        stepCountIs(tranStep),
        vuotTranToken(nganSachAnToan(tranToken)),
        // Guard đã chốt chặn thì dừng vòng. Dừng ở đây step cuối vẫn còn tool
        // call, nên `canLuotChot` bắt được và lượt đi vào lượt chốt - model
        // buộc phải trả lời bằng những gì đã thu được, thay vì để người dùng
        // nhận câu tường thuật tiến trình.
        () => guard.daChan(),
      ],
      maxOutputTokens: getTuning("LLM_MAX_OUTPUT_TOKENS"),
      // Bật thinking theo LLM_REASONING_EFFORT - kiểm chứng bằng
      // usage.outputTokenDetails.reasoningTokens > 0 trong log bên dưới
      providerOptions: resolveReasoningOptions(agent),
      maxRetries: 2,
      // Chặn trên cho CẢ lượt. Không có nó, router nhận kết nối rồi treo sẽ ăn
      // 300s (undici) x maxRetries x số step, khóa thread hàng giờ trong khi tin
      // nhắn sau xếp hàng chờ. `totalMs` bao gồm cả thời gian chạy tool, nên giá
      // trị này bắt buộc lớn hơn IMAGE_GEN_TIMEOUT_MS.
      timeout: { totalMs: getTuning("LLM_TURN_TIMEOUT_MS") },
      // Log từng tool call kèm input + đầu output: khi bot trả lời kém phải đọc
      // được ngay nó fetch trang nào và thấy gì (vụ dò vé số chỉ có số steps,
      // toàn bộ chẩn đoán phải đi đường vòng qua DB + tái hiện tay)
      onStepFinish: quanSatStep,
    });

  /**
   * Lượt CHỐT khi đã hết step: nối lại đúng những gì model vừa làm rồi hỏi lại
   * mà KHÔNG cấp tool. Không cấp tool là điểm mấu chốt - còn tool thì model lại
   * gọi tiếp và rơi vào đúng cái bẫy vừa thoát ra.
   */
  const runWrapUp = async (daLam: ModelMessage[]): Promise<string> => {
    const nhacChot: ModelMessage = {
      role: "user",
      content:
        "Bạn đã hết lượt gọi công cụ. Dựa vào những gì đã thu thập được ở trên, hãy trả lời người dùng NGAY BÂY GIỜ. Nói rõ phần nào chắc chắn, phần nào còn thiếu vì chưa tra xong - đừng bịa cho đủ. Không kể lể tiến trình, không hứa sẽ tra thêm.",
    };
    // Lượt chốt PHẢI đi qua ngân sách. Nếu không, cách chữa cho "ngữ cảnh sắp
    // tràn" lại là thực hiện một lần gọi TO HƠN lần vừa suýt tràn: nó gửi cả
    // `messages` lẫn toàn bộ `daLam` (tool call + tool result của mọi step) cộng
    // thêm lời nhắc. Chốt xong lại 400 thì mất trắng công của cả lượt.
    //
    // Bảo vệ 2 tin cuối: lời nhắc chốt, và tin của lượt hiện tại đứng ngay
    // trước nó trong `daLam` - bỏ một trong hai là hỏng chính mục đích lượt chốt.
    const { tinNhan: tinChot, daCat: daCatChot } = catNguCanhTheoNganSach({
      tinNhan: [...messages, ...daLam, nhacChot],
      tranToken: nganSachAnToan(tranToken),
      soTinBaoVeCuoi: 2,
      coAnh: getTuning("ZALO_IMAGE_QUALITY"),
    });
    if (daCatChot) log.warn({ ...daCatChot }, "Đã cắt bớt ngữ cảnh cho lượt chốt");

    const r = await generateText({
      model: resolveModel(agent, { accountId: account.id, threadId: latest.threadId }),
      system: buildSystemPrompt(agent, latest, memory, account, isolated),
      messages: tinChot,
      maxOutputTokens: getTuning("LLM_MAX_OUTPUT_TOKENS"),
      maxRetries: 1,
      timeout: { totalMs: getTuning("LLM_TURN_TIMEOUT_MS") },
    });
    if (getTuning("AGENT_TRACE_ENABLED")) {
      trace.push(summarizeStep(r.steps[0] ?? {}, getTuning("AGENT_TRACE_MAX_CHARS"), lanChay + 1));
    }
    return r.text;
  };

  const isGlitch = (r: Awaited<ReturnType<typeof runOnce>>) =>
    isEmptyRouterCompletion({
      text: r.text,
      toolCallCount: r.steps.reduce((sum, s) => sum + s.toolCalls.length, 0),
      totalTokens: r.totalUsage.totalTokens ?? 0,
    });

  /**
   * Dựng lại input KHÔNG kèm pixel rồi chạy lại - đường reactive fallback khi
   * provider từ chối lượt có ảnh bằng 4xx.
   */
  const thuLaiKhongPixel = async (err: unknown) => {
    const fallbackMode: ImageContextMode = isSidecarConfigured() ? "describe" : "blind";
    log.warn(
      { imageMode, fallbackMode, err: forLog(err, 200) },
      "Provider từ chối lượt có ảnh (4xx) - thử lại không kèm pixel",
    );
    const rebuilt = await buildTurnMessages({
      history,
      batch,
      override: agent,
      forceMode: fallbackMode,
      allowlist: account.allowlist,
      // Đường này từng QUÊN truyền trần, nên lượt thử lại chạy hoàn toàn không
      // có ngân sách - đúng lúc ngữ cảnh đã nặng tới mức provider vừa từ chối
      tranToken,
    });
    messages = rebuilt.messages;
    imageMode = rebuilt.imageMode;
    if (rebuilt.daCat) {
      log.warn({ ...rebuilt.daCat, tranToken }, "Ngữ cảnh vượt ngân sách ở lượt dựng lại - đã cắt bớt");
    }
    lanChay++;
    guard.datLai();
    return runOnce();
  };

  /**
   * Chữa theo ĐÚNG loại lỗi provider. Mỗi loại thử lại TỐI ĐA MỘT lần - vòng
   * lặp đã có hai tầng chịu lỗi (`maxRetries` của SDK, retry completion rỗng),
   * chồng thêm backoff nhiều tầng là ba tầng đè nhau.
   */
  const chuaLoiProvider = async (err: unknown) => {
    const loai = phanLoaiLoiProvider(err);
    log.error({ loai, ma: maHttpCua(err), err: forLog(err, 300) }, "Lượt agent lỗi từ provider");

    if (loai === "auth" || loai === "cau_hinh") {
      // KHÔNG thử lại: sai khóa (hoặc chưa nhập cấu hình) thì thử thêm chỉ chậm
      // gấp ba rồi vẫn hỏng. Ném ra để caller trả câu nói rõ đây là chuyện cấu
      // hình, không phải trục trặc thoáng qua.
      throw err;
    }

    if (loai === "rate_limit") {
      const cho = giayChoLai(err) ?? 5;
      log.warn({ giayCho: cho }, "Provider siết nhịp - chờ rồi thử lại đúng 1 lần");
      await new Promise((r) => setTimeout(r, cho * 1000));
      lanChay++;
      guard.datLai();
      return runOnce();
    }

    if (loai === "context_overflow") {
      // Cắt SÂU HƠN lần đầu (một nửa ngân sách thường): provider vừa nói thẳng
      // là quá dài, nên ước lượng của mình đang lạc quan hơn thực tế.
      const { tinNhan: hep, daCat } = catNguCanhTheoNganSach({
        tinNhan: messages,
        tranToken: Math.floor(nganSachAnToan(tranToken) / 2),
        soTinBaoVeCuoi: 1,
        coAnh: getTuning("ZALO_IMAGE_QUALITY"),
      });
      log.warn({ ...daCat }, "Provider báo tràn ngữ cảnh - cắt sâu hơn rồi thử lại 1 lần");
      messages = hep;
      lanChay++;
      guard.datLai();
      return runOnce();
    }

    // transient + unknown: `maxRetries` của SDK đã thử rồi mà vẫn hỏng, thử
    // thêm ở đây chỉ lặp lại đúng việc đó. Ném ra cho caller báo người dùng.
    throw err;
  };

  let result: Awaited<ReturnType<typeof runOnce>>;
  try {
    result = await runOnce();
  } catch (err) {
    // Reactive fallback: lượt đang đính pixel mà provider từ chối bằng 4xx
    // (endpoint ngoài 9Router không khai capability, detect đoán lạc quan) ->
    // ghi nhớ model mù + dựng lại input không pixel rồi thử lại 1 lần.
    // Combo qua 9Router không rơi vào đây - router lột ảnh êm, không lỗi.
    const pixelModes: ImageContextMode[] = ["native", "hybrid"];
    if (!pixelModes.includes(imageMode) || !hasImageParts(messages) || !isImageRejectionError(err)) {
      // KHÔNG phải lỗi ảnh: phân loại rồi chữa đúng bệnh. Nhánh này phải nằm
      // SAU nhánh ảnh ở trên - lỗi ảnh cũng là 400, để bộ phân loại chạy trước
      // thì nó ra "unknown" và đường bỏ pixel không bao giờ chạy.
      result = await chuaLoiProvider(err);
    } else {
      markModelNoVision(agent);
      result = await thuLaiKhongPixel(err);
    }
  }

  // 9Router thỉnh thoảng trả 200 + completion rỗng (0 token). maxRetries của
  // SDK không retry vì response "thành công" - phải tự thử lại 1 lần.
  if (isGlitch(result)) {
    log.warn("Router trả completion rỗng (0 token) - thử lại 1 lần");
    lanChay++;
    guard.datLai();
    result = await runOnce();
  }

  const doLechUocLuong = soSanhUocLuong(
    uocLuongTokenTinNhan(messages, TOKEN_MOI_ANH_THEO_CO[getTuning("ZALO_IMAGE_QUALITY")]),
    result.steps[0]?.usage?.inputTokens,
  );

  // info + kèm tên tool: khi bot trả lời kém ("chưa lấy được kết quả...") phải
  // nhìn được ngay nó ĐÃ gọi gì - trước đây chỉ có số steps, debug toàn phải đoán
  log.info(
    {
      batchSize: batch.length,
      // native = model tự đọc ảnh; describe = sidecar mô tả; hybrid = combo
      // nhận cả pixel + mô tả; blind = bỏ ảnh. Lượt bị reactive fallback thì
      // đây là chế độ THẬT đã chạy (describe/blind), không phải chế độ ban đầu.
      imageMode,
      steps: result.steps.length,
      finishReason: result.finishReason,
      // Model THẬT đã trả lời (router có thể âm thầm route sang model khác)
      model: result.response.modelId,
      reasoningEffort: resolveReasoningEffort(agent),
      // > 0 là bằng chứng CHẮC CHẮN cache đang trúng. Bằng 0 thì KHÔNG kết luận
      // được gì: đọc source 9Router (`translator/response/openai-responses.js`)
      // thì nó CÓ đọc `input_tokens_details.cached_tokens` và truyền vào
      // `buildUsage`, nhưng `buildUsage` (`translator/concerns/usage.js`) chỉ
      // thêm `prompt_tokens_details` khi giá trị > 0 - nên "upstream báo 0 lần
      // trúng" và "upstream không báo trường này" về tới client giống hệt nhau.
      // Muốn biết thật thì soi CACHED TOKENS trên dashboard 9Router.
      cachedTokens: result.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
      toolCalls: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
      usage: result.totalUsage,
      // Ước lượng cạnh SỐ THẬT, ghi ở MỌI lượt chứ không chỉ lượt bị cắt.
      //
      // Đây là đường hiệu chỉnh duy nhất cho hai hằng số trong `token-estimate.ts`
      // (ký tự/token và token mỗi ảnh): không đo được từ bảng `agent_turns` vì
      // cột ở đó là TỔNG qua mọi step. So với `steps[0].usage.inputTokens` -
      // step ĐẦU là lần gọi duy nhất mà input đúng bằng thứ mình vừa ước lượng,
      // các step sau đã cộng thêm tool result mà ước lượng không thấy.
      uocLuong: doLechUocLuong,
    },
    "Hoàn thành lượt agent",
  );

  // Vẫn rỗng sau retry: trả lời fallback thay vì im lặng bỏ treo người nhắn.
  // Lượt "chỉ thả reaction" hợp lệ không dính nhánh này (có tool call + token).
  if (isGlitch(result)) {
    log.error(
      "Router trả completion rỗng 2 lần liên tiếp - trả lời fallback. Cần soi log 9Router.",
    );
    return {
      text: ROUTER_DOWN_REPLY,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, steps: result.steps.length },
    };
  }

  // Chạm trần step: vòng lặp dừng vì HẾT LƯỢT chứ không phải vì model xong việc,
  // nên `result.text` là text của step đang-gọi-tool. Từ lúc persona dạy model
  // kể tiến trình, text đó là câu tường thuật kiểu "Đủ 2 nguồn - giờ đối chiếu
  // và trả lời." - gửi thẳng xuống Zalo là người dùng nhận đúng câu đó làm câu
  // trả lời, rồi lượt sau model đọc history thấy mình đã trả lời như vậy.
  // (Trước khi có persona đó thì text rỗng và bot im lặng - cũng hỏng.)
  // Chữa bằng một lượt chốt KHÔNG cấp tool: model buộc phải viết câu trả lời từ
  // những gì đã thu thập, thay vì vứt bỏ toàn bộ công sức của 8 step.
  //
  // Từ khi `stopWhen` có thêm điều kiện TOKEN, lượt còn dừng sớm được với
  // `steps.length < maxSteps` - nên điều kiện phải là `canLuotChot` (step cuối
  // còn gọi tool) chứ không phải `hitStepLimit` (đòi thêm đủ step). Dùng nhầm
  // hàm cũ thì lượt dừng vì token gửi thẳng câu tường thuật xuống Zalo.
  const lastStepToolCalls = result.steps.at(-1)?.toolCalls.length ?? 0;
  if (canLuotChot({ lastStepToolCalls })) {
    // Nhãn phải kể ĐÚNG một trong BA điều kiện dừng. Bản đầu chỉ có hai nên viết
    // nhị phân "hết step" : "chạm trần token"; guard thêm vào sau, và mọi lần
    // guard chặn đều bị log ghi nhầm là chạm trần token - đúng dòng log mà người
    // ta đọc để hiểu vì sao lượt cụt.
    const hetStep = hitStepLimit({
      stepCount: result.steps.length,
      maxSteps: tranStep,
      lastStepToolCalls,
    });
    const chan = guard.lyDoChan();
    log.warn(
      {
        steps: result.steps.length,
        maxSteps: tranStep,
        lyDo: nhanLyDoDung({ maGuardChan: chan?.ma, hetStep }),
        // Giữ nguyên câu của guard: nó đã nói rõ tool nào, bao nhiêu lần
        guard: chan?.thongDiep,
      },
      "Vòng lặp dừng khi model vẫn đang gọi tool - chạy một lượt chốt không cấp tool",
    );
    const chot = await runWrapUp(result.response.messages).catch((err: unknown) => {
      log.error({ err }, "Lượt chốt cũng lỗi");
      return null;
    });
    return {
      text: chot?.trim() || STEP_LIMIT_REPLY,
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        totalTokens: result.totalUsage.totalTokens ?? 0,
        steps: result.steps.length,
      },
    };
  }

  return {
    text: result.text.trim(),
    usage: {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      totalTokens: result.totalUsage.totalTokens ?? 0,
      steps: result.steps.length,
    },
  };
}
