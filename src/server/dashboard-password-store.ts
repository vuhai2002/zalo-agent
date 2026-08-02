import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "../conversation/database.js";
import { env } from "../config/env.js";

/**
 * Mật khẩu dashboard: đổi được từ web thay vì phải sửa `.env` rồi khởi động lại.
 *
 * DB thắng env, đúng nếp mọi cấu hình chỉnh-nóng khác của dự án
 * (`runtime-tuning-settings.ts`). Env vẫn giữ vai trò CÔNG TẮC: không set
 * `DASHBOARD_PASSWORD` là dashboard tắt hẳn (`startDashboardServer`) - giữ
 * nguyên mặc định an toàn, và không tự dựng một cửa đăng nhập mà người vận
 * hành không hề bật.
 *
 * Lưu bằng scrypt (có sẵn trong Node, không thêm dependency): đọc được file DB
 * cũng không suy ngược ra mật khẩu. KHÔNG dùng `encryptSecret` như API key -
 * key giải mã nằm ngay trong `.env` cạnh đó, mà mật khẩu thì không bao giờ cần
 * đọc lại bản rõ, chỉ cần so khớp.
 *
 * QUÊN MẬT KHẨU: xoá đúng một dòng là quay về mật khẩu trong `.env`
 *   sqlite3 data/zalo-agent.db "DELETE FROM runtime_settings WHERE key='dashboard_password';"
 * Đây là đường khôi phục CỐ Ý, không phải lỗ hổng: ai sửa được file DB trên đĩa
 * thì đã đọc được cookie Zalo và toàn bộ lịch sử chat nằm ngay trong đó rồi.
 */

const KEY = "dashboard_password";
/** Tham số scrypt mặc định của Node; 64 byte đầu ra cho thoải mái biên */
const KEY_LEN = 64;

const getStmt = db.prepare("SELECT value FROM runtime_settings WHERE key = ?");
const setStmt = db.prepare(`
  INSERT INTO runtime_settings (key, value, updated_at)
  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

/** "<salt hex>:<hash hex>" - salt riêng mỗi lần đặt, không dùng chung */
function hashPassword(plain: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(plain, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

function readStored(): string | undefined {
  return (getStmt.get(KEY) as { value: string } | undefined)?.value;
}

/** Đã từng đổi mật khẩu từ web chưa (chưa thì đang dùng giá trị trong .env) */
export function hasStoredPassword(): boolean {
  return readStored() !== undefined;
}

/**
 * Mật khẩu nhập vào có đúng không. Bản lưu trong DB (nếu có) thắng `.env`.
 *
 * So sánh thời gian không đổi ở CẢ HAI nhánh: nhánh env so chuỗi thô nên phải
 * tự bọc `timingSafeEqual`, nhánh DB so hai hash cùng độ dài nên an toàn sẵn.
 */
export function verifyPassword(input: string): boolean {
  const stored = readStored();
  if (stored === undefined) {
    if (!env.DASHBOARD_PASSWORD) return false;
    return safeEqualUtf8(input, env.DASHBOARD_PASSWORD);
  }

  const [salt, hash] = stored.split(":");
  // Bản ghi hỏng (sửa tay) thì coi như không khớp, KHÔNG rơi về env: rơi về
  // env nghĩa là xoá một dòng DB là hạ mật khẩu về giá trị cũ - đúng thứ mà
  // người đổi mật khẩu muốn tránh.
  if (!salt || !hash) return false;

  const thu = Buffer.from(scryptSync(input, salt, KEY_LEN).toString("hex"), "utf8");
  const that = Buffer.from(hash, "utf8");
  if (thu.length !== that.length) return false;
  return timingSafeEqual(thu, that);
}

/** So sánh 2 chuỗi có độ dài KHÁC nhau mà không lộ độ dài qua thời gian chạy */
function safeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Độ dài khác nhau thì timingSafeEqual ném lỗi, nên vẫn phải so 1 lần trên
  // dữ liệu cùng cỡ để thời gian chạy không phụ thuộc độ dài input
  const dai = Math.max(ba.length, bb.length);
  const pa = Buffer.alloc(dai);
  const pb = Buffer.alloc(dai);
  ba.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ba.length === bb.length;
}

/**
 * Đặt mật khẩu mới. Gọi xong PHẢI đá hết phiên cũ ở tầng gọi
 * (`dashboard-auth.ts` làm việc đó qua `passwordFingerprint`) - đổi mật khẩu
 * mà cookie cũ vẫn dùng được thì đổi để làm gì.
 */
export function setStoredPassword(plain: string): void {
  setStmt.run(KEY, hashPassword(plain));
}

/**
 * Dấu vân tay của mật khẩu ĐANG hiệu lực, để phiên cũ tự hết giá trị khi đổi.
 * Trả thẳng chuỗi đã lưu (đã là hash + salt) hoặc giá trị env - `dashboard-auth`
 * băm lại lần nữa trước khi ghi vào phiên nên không có bản rõ nào ra khỏi đây.
 */
export function currentPasswordMaterial(): string {
  return readStored() ?? env.DASHBOARD_PASSWORD ?? "";
}
