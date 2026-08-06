import { setupTestEnv } from "../src/shared/test-env-setup.js";
import { docLlmTuDbThat } from "./read-real-llm-settings.js";
import { docTraCuuTuDbThat, type TraCuuThat } from "./read-real-search-settings.js";

/**
 * Dựng env cho bộ eval: DB TẠM nhưng cấu hình LLM THẬT.
 *
 * `setupTestEnv` cố tình ép `LLM_PROVIDER=anthropic` / `LLM_API_KEY=test-key`
 * cho `pnpm test` chạy giống nhau ở mọi máy. Bộ eval cần ngược lại: DB tạm để
 * không đụng `data/zalo-agent.db` thật, nhưng phải gọi được model thật, nên
 * phải đọc `.env` rồi truyền ngược vào làm override.
 *
 * Cấu hình LLM đọc theo ĐÚNG luật production: DB (dashboard) đè `.env` - xem
 * `read-real-llm-settings.ts`. DB đọc ở đây là DB THẬT (chỉ đọc), còn lượt agent
 * vẫn chạy trên DB tạm.
 */

export type CauHinhLlm = {
  provider: string;
  model: string;
  baseUrl?: string;
  /** Trường nào lấy từ DB (dashboard) thay vì .env - in ra cho người chạy biết */
  tuDb: string[];
};

export type KetQuaDungEnv =
  | { ok: true; dataDir: string; llm: CauHinhLlm; traCuu: TraCuuThat }
  | { ok: false; loi: string };

export function dungEvalEnv(): KetQuaDungEnv {
  try {
    process.loadEnvFile();
  } catch {
    // Không có .env cũng được, miễn là biến đã nằm sẵn trong môi trường
  }

  // DB ĐÈ .env - ĐÚNG luật `getEffectiveLlmSettings()` của production. Đọc
  // riêng .env là đo một hệ thống khác với hệ thống đang chạy: model cấu hình
  // qua dashboard nằm ở DB, còn .env chỉ là lớp dự phòng và rất hay để lại giá
  // trị cũ.
  const db = docLlmTuDbThat();
  // PHẢI đọc trước `setupTestEnv`: hàm đó trỏ DATA_DIR sang thư mục tạm, đọc
  // sau là đọc nhầm DB tạm rỗng rồi tưởng dashboard không cấu hình gì.
  const traCuu = docTraCuuTuDbThat();
  const provider = db.provider ?? process.env.LLM_PROVIDER ?? "";
  const model = db.model ?? process.env.LLM_MODEL ?? "";
  const apiKey = db.apiKey ?? process.env.LLM_API_KEY ?? "";
  const baseUrl = db.baseUrl ?? process.env.LLM_BASE_URL ?? "";

  // Thiếu thì DỪNG HẲN, không chạy nửa vời: chạy tiếp với key giả thì mọi case
  // đỏ vì lỗi mạng, và người đọc bảng kết quả sẽ tưởng agent hỏng.
  if (!apiKey) {
    return {
      ok: false,
      loi:
        "Thiếu API key cho LLM. Bộ eval gọi MODEL THẬT nên bắt buộc phải có khóa thật -\n" +
        "  nhập ở trang Providers trên dashboard, hoặc đặt LLM_API_KEY trong .env.\n" +
        "  (pnpm test thì không cần - nó chạy model giả.)",
    };
  }
  if (!model) return { ok: false, loi: "Thiếu LLM_MODEL trong .env" };
  if (provider === "openai-compatible" && !baseUrl) {
    return { ok: false, loi: "LLM_PROVIDER=openai-compatible thì phải có LLM_BASE_URL" };
  }

  const dataDir = setupTestEnv({
    LLM_PROVIDER: provider,
    LLM_MODEL: model,
    LLM_API_KEY: apiKey,
    ...(baseUrl ? { LLM_BASE_URL: baseUrl } : {}),
    // Lượt eval không cần chờ gì: bỏ delay gửi và debounce gộp tin
    SEND_DELAY_MIN_MS: "0",
    SEND_DELAY_MAX_MS: "0",
    // Trace là NGUỒN DỮ LIỆU của bộ eval (đọc tool đã gọi từ đó), không phải
    // tùy chọn chẩn đoán - tắt là mọi khẳng định về tool đều mù
    AGENT_TRACE_ENABLED: "true",
    // Trần token ĐẦU RA phải khớp production. `setupTestEnv` đặt 2048 cho hợp
    // với test model giả, nhưng eval mà chạy bằng con số đó là đo một hệ thống
    // khác: 2048 token đủ để cắt ngang câu trả lời dài, đúng loại case mà
    // persona dặn "PHẢI trình bày đầy đủ". Nặng hơn, tổ hợp đó vi phạm chính
    // luật chéo của repo (`DOCUMENT_MAX_CHARS/4 > LLM_MAX_OUTPUT_TOKENS*0.7`)
    // nên trang Cấu hình còn từ chối lưu - eval không được chạy bằng cấu hình
    // mà dashboard không cho phép tồn tại.
    LLM_MAX_OUTPUT_TOKENS: "16384",
    // Trần thời gian NGẮN hơn hẳn mặc định (15 phút): eval chạy tay và tuần tự,
    // một case treo là ngồi đợi cả bộ. 3 phút vẫn dư cho lượt nặng nhất ở đây
    // (tra web rồi tổng hợp), vì các tool đắt thời gian như vẽ ảnh đều bị tắt
    // trong bộ case.
    LLM_TURN_TIMEOUT_MS: "180000",
  });

  return {
    ok: true,
    dataDir,
    llm: { provider, model, baseUrl: baseUrl || undefined, tuDb: db.tuDb },
    traCuu,
  };
}
