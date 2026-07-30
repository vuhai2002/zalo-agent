import path from "node:path";
// Dùng SQLite built-in của Node (>= 22.13) - không cần native build (better-sqlite3
// yêu cầu Visual Studio Build Tools trên Windows). 1 connection dùng chung cho
// mọi store (history/thread/contact/usage) - node:sqlite là sync nên không cần pool.
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../config/env.js";

export const db = new DatabaseSync(path.join(dataDir, "zalo-agent.db"));
db.exec("PRAGMA journal_mode = WAL;");

runMigrations();

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      sender_name TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_account_thread
      ON messages (account_id, thread_id, id);

    CREATE TABLE IF NOT EXISTS threads (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      thread_type INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      bot_enabled INTEGER NOT NULL DEFAULT 1,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      last_sender_name TEXT,
      PRIMARY KEY (account_id, thread_id)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      account_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      message_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Não của bot: persona + model override, gắn vào account qua accounts.agent_id.
    -- DB là source of truth (config/accounts.json chỉ seed 1 lần đầu).
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      icon TEXT NOT NULL DEFAULT '🤖',
      name TEXT NOT NULL,
      persona TEXT NOT NULL DEFAULT '',
      model_provider TEXT,
      model_name TEXT,
      max_steps INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Tài khoản Zalo (kênh): policies + gắn não. N account dùng chung 1 agent được.
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      agent_id TEXT NOT NULL,
      allowlist_mode TEXT NOT NULL DEFAULT 'all' CHECK (allowlist_mode IN ('all', 'list')),
      allowlist_user_ids TEXT NOT NULL DEFAULT '[]',
      group_require_mention INTEGER NOT NULL DEFAULT 1,
      respond_to_groups INTEGER NOT NULL DEFAULT 1,
      group_passive_listen INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Memory lớp 3: fact bền do agent tự lưu qua tool save_memory.
    -- learned_in_group quyết định quy tắc inject bất đối xứng (private không ra public)
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      content TEXT NOT NULL,
      learned_in_thread_id TEXT NOT NULL,
      learned_in_group INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memories_account_subject
      ON memories (account_id, subject_id, id);

    -- Phiên đăng nhập dashboard. Có bản ghi thật thì logout mới thu hồi được
    -- (token HMAC stateless không xóa được), và password_fingerprint cho phép
    -- đổi DASHBOARD_PASSWORD là mọi phiên cũ hết hiệu lực ngay.
    CREATE TABLE IF NOT EXISTS dashboard_sessions (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      password_fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- Cache mô tả ảnh do vision sidecar sinh ra (khi model chính không đọc được
    -- ảnh). Key theo đường dẫn file trong data/media - mỗi ảnh chỉ mô tả 1 lần.
    CREATE TABLE IF NOT EXISTS image_descriptions (
      rel_path TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS agent_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      steps INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_turns_account_created
      ON agent_turns (account_id, created_at);

    -- Trace từng step của lượt agent: model nói gì, gọi tool nào với tham số
    -- gì, provider cảnh báo gì. Không có bảng này thì bot trả lời sai chỉ còn
    -- cách suy luận ngược từ câu lỗi (đã dính vụ dò vé số và vụ imageIndex).
    -- Bảng này phình nhanh nhất trong DB nên có dọn theo AGENT_TRACE_RETENTION_DAYS.
    CREATE TABLE IF NOT EXISTS agent_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      reasoning TEXT NOT NULL DEFAULT '',
      tool_calls TEXT NOT NULL DEFAULT '[]',
      tool_results TEXT NOT NULL DEFAULT '[]',
      finish_reason TEXT NOT NULL DEFAULT '',
      warnings TEXT NOT NULL DEFAULT '[]',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_steps_turn ON agent_steps (turn_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_agent_steps_created ON agent_steps (created_at);

    -- Lịch hẹn: trạng thái HIỆN TẠI của từng job (bot tự nhắn theo lịch).
    -- Tách khỏi scheduled_job_runs (bảng NGAY DƯỚI) vì last_status ở đây chỉ
    -- nói lần chạy CUỐI - job hỏng 5 lần rồi lần 6 chạy được sẽ trông khoẻ
    -- mạnh hoàn hảo nếu không có log riêng kể lại từng lần.
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      thread_type INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('message', 'agent')),
      payload TEXT NOT NULL,
      schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('once', 'every', 'cron')),
      run_at TEXT,
      every_minutes INTEGER,
      cron_expr TEXT,
      -- Rỗng = hiểu theo BOT_TIMEZONE tại thời điểm CHẠY (đổi cấu hình là job
      -- đổi theo ngay); có giá trị = job pin cứng đúng zone này bất kể sau
      -- này BOT_TIMEZONE đổi ra sao.
      timezone TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      -- NULL = vô hạn; 'once' mặc định 1. Chạm mức này thì enabled=0 và
      -- next_run_at=NULL nhưng GIỮ NGUYÊN row - xoá hẳn (như Hermes/goclaw)
      -- làm lời nhắc đã hẹn biến mất không dấu vết.
      max_runs INTEGER,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    -- Vòng tick quét job đến hạn: WHERE enabled = 1 AND next_run_at <= now
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs (enabled, next_run_at);
    -- Tool list/cancel/update chỉ được thấy job của đúng (account, thread) đang chat
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_thread ON scheduled_jobs (account_id, thread_id);

    -- Sổ ghi ĐÃ XẢY RA GÌ ở từng lần job chạy - khác scheduled_jobs.last_status
    -- vốn chỉ nói lần cuối. turn_id nối sang agent_turns cho job kind='agent',
    -- bấm thẳng sang trang Trace khi cần biết vì sao job trả lời sai.
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      turn_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'silent', 'skipped', 'error', 'interrupted')),
      detail TEXT NOT NULL DEFAULT '',
      delivered_chars INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      finished_at TEXT
    );
    -- Lịch sử của 1 job, mới nhất trước; dọn quá SCHEDULER_RUN_LOG_KEEP theo job_id
    CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_job ON scheduled_job_runs (job_id, id DESC);

    -- Đếm tin CHỦ ĐỘNG đã gửi mỗi (account, thread, ngày VN) cho trần
    -- SCHEDULER_MAX_PROACTIVE_PER_DAY - bền qua restart. CỐ Ý không đếm từ
    -- scheduled_job_runs: bảng đó bị prune xuống SCHEDULER_RUN_LOG_KEEP dòng
    -- MỖI JOB ngay mỗi lần mở lượt, nên 1 job dày (vd every 5 phút) làm dòng
    -- 'ok' buổi sáng bị xoá trong vài giờ - đếm lại tụt về 0 giữa ngày.
    CREATE TABLE IF NOT EXISTS proactive_send_counters (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      day_key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      notice_sent INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (account_id, thread_id, day_key)
    );
  `);

  // Tool CHẠY LỖI: AI SDK để chúng ở content dạng tool-error, không vào
  // toolResults, nên trước cột này mọi lần tool hỏng đều mất tăm khỏi trace.
  addColumnIfMissing("agent_steps", "tool_errors", "TEXT NOT NULL DEFAULT '[]'");

  // Lần chạy thứ mấy trong cùng lượt. Không có cột này thì trace của lượt có
  // retry đọc ra 1,1,2,2,3,3 và trông y hệt model lặp vô hạn. Mặc định 1 để
  // mọi dòng ghi trước đây vẫn hợp lệ.
  addColumnIfMissing("agent_steps", "attempt", "INTEGER NOT NULL DEFAULT 1");

  // Mức suy nghĩ riêng cho từng agent (NULL = theo mức mặc định chung)
  addColumnIfMissing("agents", "reasoning_effort", "TEXT");

  // DB tạo trước khi có cột sender_id: ALTER thêm (nullable - tin cũ không có id)
  addColumnIfMissing("messages", "sender_id", "TEXT");
  // Ảnh kèm tin nhắn: JSON array đường dẫn file trong data/media (tương đối DATA_DIR)
  // để lượt sau nạp lại cho model xem; NULL = tin không có ảnh
  addColumnIfMissing("messages", "images", "TEXT");
  // Memory lớp 2: rolling summary per thread
  addColumnIfMissing("threads", "summary", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("threads", "summary_covers_to_message_id", "INTEGER NOT NULL DEFAULT 0");

  // Phản hồi tức thì: thả reaction + báo "đang nhập" khi bot bắt đầu xử lý
  addColumnIfMissing("accounts", "auto_react_enabled", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing("accounts", "auto_react_icon", "TEXT NOT NULL DEFAULT 'heart'");
  addColumnIfMissing("accounts", "typing_indicator_enabled", "INTEGER NOT NULL DEFAULT 1");
  // Trang Tools: JSON array key tool bị tắt per account (rỗng = bật hết).
  // Lưu danh sách TẮT thay vì BẬT để tool mới thêm vào code tự bật cho account cũ.
  addColumnIfMissing("accounts", "disabled_tools", "TEXT NOT NULL DEFAULT '[]'");

  // Lượt do lịch hẹn tự bắn (source='schedule') khác lượt trả lời tin nhắn
  // (source='message') - Overview và trang Trace cần phân biệt được "có người
  // đang chat" với "job tự chạy lúc 3 giờ sáng". Mặc định 'message' để mọi
  // lượt ghi TRƯỚC khi có scheduler vẫn đúng nghĩa, không cần backfill.
  addColumnIfMissing("agent_turns", "source", "TEXT NOT NULL DEFAULT 'message'");

  // Đếm số lần THỬ GỬI THẤT BẠI LIÊN TIẾP (delivery-attempt-store.ts) - job
  // gửi hỏng chỉ bị tiêu suất chạy sau khi chạm MAX_DELIVERY_ATTEMPTS, không
  // phải ngay lần đầu (bất biến "chưa từng gửi được thì không coi là đã
  // chạy"). Mặc định 0 để mọi job cũ coi như chưa từng thử hỏng lần nào.
  addColumnIfMissing("scheduled_jobs", "delivery_attempts", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function closeDatabase(): void {
  db.close();
}
