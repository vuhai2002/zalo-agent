import { canTraCuuWeb, kiemTraTienDeTraCuu } from "./preflight-web-search.js";
import { dungEvalEnv } from "./eval-env.js";
import { EVAL_CASES } from "./eval-cases.js";
import { taoFakeZaloApi } from "./fake-zalo-api.js";
import { inBang, type KetQuaCase } from "./eval-report.js";
import { dungGocNhinDinhDang } from "./eval-formatting-view.js";
import { chamCase, phatHienLuotHong } from "./eval-assert.js";

/**
 * `pnpm eval` - chạy bộ case với MODEL THẬT.
 *
 * Khác `pnpm test` ở mục đích, không phải ở mức độ: test chạy model giả nên đo
 * được chuyện tất định (dây nối, nhánh lỗi, thứ tự). Model giả trả về đúng thứ
 * mình lập trình cho nó trả, nên nó KHÔNG nói được gì về việc model thật có tra
 * cứu thay vì đoán không, hay có tệ đi sau khi mình sửa persona không.
 *
 * Ba ràng buộc sống còn, mỗi cái vá một cách bộ eval có thể tự phản bội mình:
 *
 *   1. KHÔNG BAO GIỜ chạm zca-js thật. `runAgentTurn` nhận `api: API` và các
 *      tool nhóm action gọi thẳng `enqueueSend` - chạy với API thật là bot nhắn
 *      thật cho người thật. Runner TỰ dựng API giả, không nhận từ ngoài.
 *   2. DB TẠM. `setupTestEnv()` chạy TRƯỚC mọi `await import()` động - bẫy đã
 *      ghi trong CLAUDE.md: `database.ts` mở SQLite ở module scope.
 *   3. Khẳng định trên HÀNH VI (gọi tool nào) và TÍNH CHẤT CẤU TRÚC, không trên
 *      câu chữ. Câu chữ dao động giữa các lần chạy, mà một bộ eval đỏ ngẫu
 *      nhiên thì người ta ngừng đọc nó - tức là mất luôn những lần đỏ thật.
 *
 * Đi qua ĐÚNG đường production (`processBatch`) chứ không gọi thẳng
 * `runAgentTurn`: như vậy lớp làm sạch đầu ra (phase 06) và đường gửi cũng nằm
 * trong phép đo, và `fakeApi.tinDaGui` chính là chữ người dùng THẬT SỰ nhận.
 */

const ACC = "eval-acc";
const AGENT = "eval-agent";

async function main(): Promise<void> {
  const env = dungEvalEnv();
  if (!env.ok) {
    console.error(`\n${env.loi}\n`);
    process.exit(1);
  }

  // Lọc tập con: `EVAL_ONLY=ngay-gio,tra-cuu pnpm eval`. Mỗi lượt là token
  // thật, nên lúc sửa một case hay thử một giả thuyết thì chạy cả bộ là phí.
  const chiChay = (process.env.EVAL_ONLY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const danhSach = chiChay.length > 0 ? EVAL_CASES.filter((c) => chiChay.includes(c.ten)) : EVAL_CASES;

  if (danhSach.length === 0) {
    console.error(`\nEVAL_ONLY="${chiChay.join(",")}" không khớp case nào.`);
    console.error(`Có: ${EVAL_CASES.map((c) => c.ten).join(", ")}\n`);
    process.exit(1);
  }

  // In rõ NGUỒN cấu hình: đọc nhầm nguồn là đo nhầm hệ thống, mà nhìn tên model
  // thôi thì không biết nó đến từ dashboard hay từ .env
  const nguon = env.llm.tuDb.length > 0 ? `dashboard: ${env.llm.tuDb.join(", ")}` : "chỉ .env";
  console.log(`Model: ${env.llm.model} (${env.llm.provider}) - nguồn ${nguon}`);
  console.log(`DB tạm: ${env.dataDir}`);
  console.log(`Số case: ${danhSach.length}${chiChay.length > 0 ? ` (lọc từ ${EVAL_CASES.length})` : ""}\n`);

  // Import ĐỘNG, sau setupTestEnv
  const toolSettings = await import("../src/config/runtime-tool-settings.js");

  // Chép cấu hình TRA CỨU từ DB thật sang DB tạm. Không chép thì eval rơi về
  // DuckDuckGo trong khi bot thật chạy Brave - đo một stack khác hẳn, và ngày
  // DuckDuckGo bị chặn thì mọi case nghiên cứu đỏ vì lý do sai.
  // Xem `read-real-search-settings.ts`.
  const traCuu = env.traCuu;
  if (traCuu.braveApiKey) toolSettings.updateSearchSettings({ braveApiKey: traCuu.braveApiKey });
  if (traCuu.provider === "brave" || traCuu.provider === "duckduckgo") {
    toolSettings.updateSearchSettings({ provider: traCuu.provider });
  }
  const nhaTraCuu = toolSettings.getSearchSettings().provider;
  console.log(
    `Tra cứu: ${nhaTraCuu}${traCuu.tuDb.length > 0 ? ` - nguồn dashboard: ${traCuu.tuDb.join(", ")}` : " - mặc định"}`,
  );

  // Tiền đề: tra cứu phải còn sống, nếu không thì bảng kết quả nói dối
  if (danhSach.some(canTraCuuWeb)) {
    const { searchWeb } = await import("../src/shared/web-search-providers.js");
    const braveKey = nhaTraCuu === "brave" ? toolSettings.getBraveApiKey() : undefined;
    const tienDe = await kiemTraTienDeTraCuu(
      async (query) => (await searchWeb(query, { maxResults: 5, braveApiKey: braveKey })).length,
      nhaTraCuu,
    );
    if (!tienDe.ok) {
      console.error(`\n${tienDe.loi}\n`);
      process.exit(1);
    }
  }

  const accountStore = await import("../src/config/account-store.js");
  const agentStore = await import("../src/config/agent-store.js");
  const threadStore = await import("../src/conversation/thread-store.js");
  const traceStore = await import("../src/agent/agent-trace-store.js");
  const processor = await import("../src/zalo/message-turn-processor.js");
  const database = await import("../src/conversation/database.js");
  const memoryStore = await import("../src/conversation/memory-store.js");
  const historyStore = await import("../src/conversation/history-store.js");
  const { cleanupTestEnv } = await import("../src/shared/test-env-setup.js");
  const { ThreadType } = await import("zca-js");
  // Chính hằng số production dùng để nhắn báo lỗi - so bằng nguồn thật, không
  // dò chữ tự chế
  const { TECHNICAL_ERROR_REPLY, LOI_THEO_LOAI } = await import(
    "../src/zalo/send-reply-in-parts.js"
  );
  const { STEP_LIMIT_REPLY } = await import("../src/agent/agent-loop.js");

  accountStore.createAccount({ id: ACC, label: "Eval" });
  agentStore.createAgent({ id: AGENT, name: "Agent eval" });

  const ketQua: KetQuaCase[] = [];
  /** Tổng số lời gọi API - CHỨNG MINH mọi thứ đi qua API giả, không ra Zalo thật */
  let tongLoiGoiApi = 0;

  try {
    // TUẦN TỰ, không song song: chạy song song vừa đụng rate limit của router
    // vừa làm bảng kết quả khó đọc khi có case đỏ
    for (const c of danhSach) {
      const threadId = `t-${c.ten}`;
      process.stdout.write(`Đang chạy ${c.ten}... `);

      agentStore.updateAgent(AGENT, {
        persona: c.persona ?? "",
        disabledTools: c.disabledTools ?? [],
      });
      threadStore.recordThreadActivity({
        accountId: ACC,
        threadId,
        threadType: c.laNhom ? 1 : 0,
        displayName: "Eval",
        lastSenderName: "Người dùng eval",
      });

      // Gieo điều bot "đã nhớ" từ trước. Xóa sạch trước mỗi case để case này
      // không thấy fact case kia vừa ghi - DB tạm dùng chung cả lượt chạy.
      database.db.exec("DELETE FROM memories");
      for (const noiDung of c.factCoSan ?? []) {
        memoryStore.saveMemoryFact({
          accountId: ACC,
          subjectId: "eval-user",
          content: noiDung,
          learnedInThreadId: threadId,
          learnedInGroup: Boolean(c.laNhom),
        });
      }

      // Gieo LỊCH SỬ có sẵn. Thread trắng là bối cảnh KHÔNG giống bot thật:
      // model bắt chước rất mạnh cách trình bày của chính nó ở lượt trước, nên
      // ca nào muốn đo sức bền của luật trước lịch sử cũ phải dựng lịch sử đó.
      for (const tin of c.lichSuTruoc ?? []) {
        historyStore.appendMessage(ACC, threadId, { role: tin.role, content: tin.content });
      }

      const fake = taoFakeZaloApi();
      const config = { ...accountStore.getAccount(ACC)!, agentId: AGENT };
      const batch = [
        {
          accountId: ACC,
          threadId,
          threadType: (c.laNhom ? ThreadType.Group : ThreadType.User) as number,
          isGroup: Boolean(c.laNhom),
          senderId: "eval-user",
          senderName: "Người dùng eval",
          text: c.tinNhan,
          images: [],
          msgId: `m-${c.ten}`,
          cliMsgId: `c-${c.ten}`,
          isSelf: false,
          mentionsMe: true,
          rawData: {},
        },
      ];

      const batDau = Date.now();
      let loiChay: string | null = null;
      try {
        // KHÔNG truyền `resolveModel` -> dùng model THẬT
        await processor.processBatch(config, fake.api, batch as never);
      } catch (err) {
        loiChay = err instanceof Error ? err.message : String(err);
      }
      const giay = (Date.now() - batDau) / 1000;

      const luot = traceStore.getRecentTurns(ACC, threadId, 1)[0];
      const steps = luot ? traceStore.getTurnTrace(luot.id) : [];
      const toolDaGoiKemArgs = steps.flatMap((s) => s.toolCalls);
      const toolDaGoi = toolDaGoiKemArgs.map((t) => t.name);
      const traLoi = fake.tinDaGui.join("\n");

      // `processBatch` BẮT lỗi rồi nhắn câu báo lỗi thay vì ném, nên `loiChay`
      // gần như luôn null - phải tự dò lượt hỏng, nếu không thì case xanh đúng
      // lúc hệ thống chết (xem `phatHienLuotHong`)
      const hong =
        loiChay ??
        phatHienLuotHong({
          tokens: luot?.totalTokens ?? 0,
          traLoi,
          // STEP_LIMIT_REPLY là câu bot trả khi vòng lặp cụt VÀ lượt chốt
          // cũng chết - thiếu nó thì case chỉ kiểm định dạng sẽ ĐẠT trong khi
          // lượt vừa thất bại hoàn toàn và tiêu tiền thật (token > 0 nên vế
          // thứ hai của `phatHienLuotHong` cũng không bắt được)
          cauLoiHeThong: [TECHNICAL_ERROR_REPLY, STEP_LIMIT_REPLY, ...Object.values(LOI_THEO_LOAI)],
        });

      const cham = chamCase(c, {
        toolDaGoi,
        toolDaGoiKemArgs,
        traLoi,
        // Định dạng THẬT SỰ tới Zalo. `traLoi` là chữ trần sau khi dịch nên
        // không đo được in đậm - xem `eval-formatting-view.ts`.
        dinhDang: dungGocNhinDinhDang(fake.tinKemDinhDang),
        loiChay: hong,
      });
      ketQua.push({
        ten: c.ten,
        dat: cham.dat,
        lyDoHong: cham.lyDoHong,
        toolDaGoi,
        tokens: luot?.totalTokens ?? 0,
        giay,
        traLoi,
      });
      tongLoiGoiApi += fake.loiGoi.length;
      console.log(cham.dat ? "ĐẠT" : "HỎNG");
    }
  } finally {
    database.closeDatabase();
    cleanupTestEnv(env.dataDir);
  }

  inBang(ketQua);
  // Bằng chứng cho ràng buộc số 1. Con số này đến từ API GIẢ, nên nó vừa nói
  // "có bấy nhiêu lời gọi Zalo" vừa nói "tất cả đều bị chặn tại đây"
  console.log(`\n${tongLoiGoiApi} lời gọi Zalo, tất cả vào API giả - không tin nào ra Zalo thật.`);
  process.exit(ketQua.some((r) => !r.dat) ? 1 : 0);
}

void main();
