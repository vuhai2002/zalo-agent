import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decryptWith } from "../src/config/secret-cipher-core.js";

/**
 * Đọc cấu hình TRA CỨU WEB đang chạy thật (nhà cung cấp + khóa Brave).
 *
 * Cùng một bài học với `read-real-llm-settings.ts`, chỉ khác chỗ đau - và lần
 * này nó đã cắn thật ngày 06/08/2026:
 *
 * Bot thật đặt `search_provider = brave` trên dashboard nên tra cứu chạy tốt.
 * Bộ eval thì chạy trên DB TẠM rỗng, không có khóa Brave, nên rơi về
 * DuckDuckGo. Hôm đó DuckDuckGo trả về 0 kết quả cho MỌI truy vấn, thế là
 * case nghiên cứu đỏ với lý do "không gọi web_fetch" - một chẩn đoán sai hoàn
 * toàn, vì model có tìm, chỉ là không nhận được URL nào để mở. Tôi suýt kết
 * luận nhầm rằng luật persona vừa sửa làm model tệ đi.
 *
 * Nói gọn: bộ eval đọc cấu hình từ NGUỒN KHÁC production là bộ eval đo một hệ
 * thống khác với hệ thống đang chạy - và điều đó đúng với MỌI cấu hình, không
 * riêng cấu hình model.
 *
 * Chỉ ĐỌC, mở `readOnly`. Lượt agent vẫn chạy trên DB tạm.
 */

export type TraCuuThat = {
  provider?: string;
  braveApiKey?: string;
  /** Lấy được gì từ DB - để in ra cho người chạy biết nguồn nào thắng */
  tuDb: string[];
};

const KHOA_PROVIDER = "search_provider";
const KHOA_BRAVE = "search_brave_api_key";

export function docTraCuuTuDbThat(): TraCuuThat {
  const duongDan = path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "zalo-agent.db");
  const ra: TraCuuThat = { tuDb: [] };

  if (!fs.existsSync(duongDan)) return ra;

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(duongDan, { readOnly: true });
    const stmt = db.prepare("SELECT value FROM runtime_settings WHERE key = ?");

    const provider = (stmt.get(KHOA_PROVIDER) as { value?: string } | undefined)?.value;
    if (provider) {
      ra.provider = provider;
      ra.tuDb.push("searchProvider");
    }

    const brave = (stmt.get(KHOA_BRAVE) as { value?: string } | undefined)?.value;
    const keyMaHoa = process.env.CREDENTIALS_ENCRYPTION_KEY;
    if (brave && keyMaHoa) {
      try {
        ra.braveApiKey = decryptWith(keyMaHoa, brave);
        ra.tuDb.push("braveKey");
      } catch {
        // Sai CREDENTIALS_ENCRYPTION_KEY thì bỏ qua - eval rơi về DuckDuckGo,
        // và bộ kiểm tra tiền đề sẽ nói rõ nếu đường đó cũng chết
      }
    }
  } catch {
    // DB bản cũ thiếu bảng, hoặc đang bị khóa - rơi về mặc định
  } finally {
    db?.close();
  }

  return ra;
}
