import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decryptWith } from "../src/config/secret-cipher-core.js";

/**
 * Đọc cấu hình LLM ĐANG CHẠY THẬT: DB đè lên `.env`, đúng luật
 * `getEffectiveLlmSettings()` của production.
 *
 * VÌ SAO PHẢI CÓ, và đây là bài học phải trả giá bằng một lần báo động sai:
 * bản đầu của bộ eval chỉ đọc `.env`. Nhưng model được cấu hình QUA DASHBOARD
 * (lưu bảng `runtime_settings`), và `.env` chỉ là lớp dự phòng. Máy dev có
 * `LLM_MODEL` cũ nằm lại trong `.env`, DB thì để giá trị đúng - nên eval gọi
 * bằng tên model sai, router trả 404, và tôi kết luận nhầm là "bot đang hỏng"
 * trong khi bot chạy hoàn toàn bình thường.
 *
 * Bài học chung: bộ eval đọc cấu hình từ NGUỒN KHÁC production là bộ eval đo
 * một hệ thống khác với hệ thống đang chạy.
 *
 * Chỉ ĐỌC, mở `readOnly` - không bao giờ ghi vào DB thật. Lượt agent vẫn chạy
 * trên DB tạm.
 */

export type LlmThat = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Có lấy được gì từ DB không - để in ra cho người chạy biết nguồn nào thắng */
  tuDb: string[];
};

const KHOA = ["llm_provider", "llm_base_url", "llm_model", "llm_api_key"] as const;

export function docLlmTuDbThat(): LlmThat {
  const thuMuc = path.resolve(process.env.DATA_DIR ?? "./data");
  const duongDan = path.join(thuMuc, "zalo-agent.db");
  const ra: LlmThat = { tuDb: [] };

  // Chưa có DB (máy mới clone) là chuyện bình thường - rơi hẳn về `.env`
  if (!fs.existsSync(duongDan)) return ra;

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(duongDan, { readOnly: true });
    const stmt = db.prepare("SELECT key, value FROM runtime_settings WHERE key = ?");

    for (const khoa of KHOA) {
      const row = stmt.get(khoa) as { value?: string } | undefined;
      const v = row?.value;
      if (!v) continue;

      if (khoa === "llm_api_key") {
        const keyMaHoa = process.env.CREDENTIALS_ENCRYPTION_KEY;
        if (!keyMaHoa) continue;
        try {
          ra.apiKey = decryptWith(keyMaHoa, v);
          ra.tuDb.push("apiKey");
        } catch {
          // Sai CREDENTIALS_ENCRYPTION_KEY thì bỏ qua, dùng key ở .env - báo lỗi
          // ở đây chỉ làm người chạy tưởng bộ eval hỏng
        }
        continue;
      }

      if (khoa === "llm_provider") { ra.provider = v; ra.tuDb.push("provider"); }
      if (khoa === "llm_base_url") { ra.baseUrl = v; ra.tuDb.push("baseUrl"); }
      if (khoa === "llm_model") { ra.model = v; ra.tuDb.push("model"); }
    }
  } catch {
    // DB thiếu bảng `runtime_settings` (bản cũ) hay đang bị khóa - rơi về .env
  } finally {
    db?.close();
  }

  return ra;
}
