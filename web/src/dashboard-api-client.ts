/** Fetch wrapper: JSON + cookie session; 401 thì đẩy về trang login */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    // Ngoài React tree nên không dùng được navigate() - đổi URL trực tiếp
    if (window.location.pathname !== "/login") window.location.assign("/login");
    throw new ApiError(401, "Chưa đăng nhập");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Lỗi ${res.status}`);
  return data as T;
}

// ===== Types khớp response server =====

export type AccountInfo = { id: string; label: string; enabled: boolean; online: boolean };
export type DailyUsage = { day: string; turns: number; inputTokens: number; outputTokens: number };
export type AccountStats = {
  threads: number;
  contacts: number;
  memories: number;
  messagesTotal: number;
  messagesToday: number;
};
export type OverviewData = {
  accounts: AccountInfo[];
  usageByAccount: { accountId: string; daily: DailyUsage[] }[];
  statsByAccount: { accountId: string; stats: AccountStats }[];
  system: {
    uptimeSeconds: number;
    nodeVersion: string;
    llm: { provider: string; model: string; hasOverride: boolean; daCauHinh: boolean };
  };
  /** Khóa ngày "hôm nay" theo BOT_TIMEZONE - server tính, frontend dùng nguyên
   *  thay vì tự suy từ giờ trình duyệt (dễ lệch với giờ VN của bot). */
  todayKey: string;
  /** Tên timezone IANA của bot, vd Asia/Ho_Chi_Minh */
  timezone: string;
  /** Số ngày của cửa sổ biểu đồ ĐANG hiệu lực (server đã kẹp về giá trị hợp lệ) */
  days: number;
};

export type ThreadItem = {
  accountId: string;
  threadId: string;
  threadType: number;
  displayName: string;
  botEnabled: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  lastSenderName: string | null;
  usage: { turns: number; totalTokens: number };
  summary: string;
};

export type MessageItem = {
  id: number;
  role: "user" | "assistant";
  senderName?: string;
  content: string;
  createdAt: string;
};

export type ContactItem = {
  accountId: string;
  userId: string;
  displayName: string;
  firstSeen: string;
  lastSeen: string;
  messageCount: number;
};

// ===== API calls =====

export const api = {
  login: (password: string) =>
    request<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ ok: true }>("/api/auth/me"),
  // Đổi xong server cấp cookie mới ngay trong response - không phải đăng nhập lại
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  overview: (days?: number) =>
    request<OverviewData>(`/api/overview${days ? `?days=${days}` : ""}`),

  threads: (accountId: string, q: string, page: number) =>
    request<{ items: ThreadItem[]; hasMore: boolean }>(
      `/api/threads?accountId=${encodeURIComponent(accountId)}&q=${encodeURIComponent(q)}&page=${page}`,
    ),
  threadMessages: (accountId: string, threadId: string, beforeId?: number) =>
    request<{ items: MessageItem[] }>(
      `/api/threads/${encodeURIComponent(threadId)}/messages?accountId=${encodeURIComponent(accountId)}` +
        (beforeId ? `&beforeId=${beforeId}` : ""),
    ),
  setBotEnabled: (accountId: string, threadId: string, botEnabled: boolean) =>
    request<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: JSON.stringify({ accountId, botEnabled }),
    }),

  contacts: (accountId: string, q: string, page: number) =>
    request<{ items: ContactItem[]; hasMore: boolean }>(
      `/api/contacts?accountId=${encodeURIComponent(accountId)}&q=${encodeURIComponent(q)}&page=${page}`,
    ),

  accountsAdmin: {
    list: () => request<{ items: ManagedAccount[] }>("/api/accounts"),
    reactionIcons: () => request<{ items: ReactionIcon[] }>("/api/accounts/reaction-icons"),
    create: (input: { id: string; label: string; agentId?: string }) =>
      request<{ account: ManagedAccount }>("/api/accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: Partial<Omit<ManagedAccount, "id" | "running" | "hasCredentials">>) =>
      request<{ account: ManagedAccount; warning?: string }>(
        `/api/accounts/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },

  tuning: {
    get: () =>
      request<{ groups: TuningGroup[]; defs: Record<string, TuningDef>; values: TuningValue[] }>("/api/tuning"),
    save: (values: Record<string, number | boolean | string | null>) =>
      request<{ values: TuningValue[] }>("/api/tuning", { method: "PUT", body: JSON.stringify({ values }) }),
  },

  agentsAdmin: {
    list: () => request<{ items: ManagedAgent[] }>("/api/agents"),
    // Cùng lý do với `update` bên dưới: POST trả bản ghi THÔ, `accountCount`
    // chỉ có ở `list()`. Khai dư thì TypeScript im lặng cho tới lúc ai đó đọc
    // trường không tồn tại.
    create: (input: { id: string; name: string; icon?: string; persona?: string }) =>
      request<{ agent: Omit<ManagedAgent, "accountCount"> }>("/api/agents", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (
      id: string,
      patch: Partial<
        Pick<
          ManagedAgent,
          | "name"
          | "icon"
          | "persona"
          | "modelProvider"
          | "modelName"
          | "maxSteps"
          | "reasoningEffort"
          | "disabledTools"
          | "contextWindow"
        >
      >,
    ) =>
      // KHÔNG phải `ManagedAgent`: route PATCH trả bản ghi THÔ, còn
      // `accountCount` chỉ có ở `list()` (tính bằng subquery). Khai đúng hình
      // dạng thật để caller buộc phải tự giữ lại `accountCount` - khai dư thì
      // TypeScript im lặng và giao diện hiện "chưa tài khoản nào dùng" sau khi lưu.
      request<{ agent: Omit<ManagedAgent, "accountCount"> }>(`/api/agents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },

  memories: (accountId: string, q: string, page: number) =>
    request<{ items: MemoryFactItem[]; hasMore: boolean }>(
      `/api/memories?accountId=${encodeURIComponent(accountId)}&q=${encodeURIComponent(q)}&page=${page}`,
    ),
  deleteMemory: (accountId: string, id: number) =>
    request<{ ok: true }>(`/api/memories/${id}?accountId=${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    }),

  tools: () =>
    request<{ items: ToolCatalogItem[]; search: SearchSettings; fetch: FetchSettings }>(
      "/api/tools",
    ),
  updateSearchSettings: (update: { provider?: "duckduckgo" | "brave"; braveApiKey?: string }) =>
    request<{ ok: true; search: SearchSettings }>("/api/tools/search", {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  updateFetchSettings: (update: { fallbackEnabled?: boolean }) =>
    request<{ ok: true; fetch: FetchSettings }>("/api/tools/fetch", {
      method: "PATCH",
      body: JSON.stringify(update),
    }),

  vision: () => request<VisionSettings>("/api/vision"),
  updateVision: (update: {
    mode?: "auto" | "on" | "off";
    sidecarBaseUrl?: string;
    sidecarModel?: string;
    sidecarApiKey?: string;
  }) =>
    request<VisionSettings & { ok: true }>("/api/vision", {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  testVisionSidecar: () =>
    request<{ ok: boolean; reply?: string; error?: string }>("/api/vision/test", {
      method: "POST",
    }),
  clearVisionSidecar: () =>
    request<VisionSettings & { ok: true }>("/api/vision/sidecar", { method: "DELETE" }),

  // Log toàn hệ thống đọc từ file - chỉ đọc, không có đường xóa
  logs: (q: { level?: string; scope?: string; search?: string; limit?: number }) => {
    const p = new URLSearchParams();
    if (q.level) p.set("level", q.level);
    if (q.scope) p.set("scope", q.scope);
    if (q.search) p.set("search", q.search);
    if (q.limit) p.set("limit", String(q.limit));
    return request<LogsResponse>(`/api/logs?${p.toString()}`);
  },

  // Trace từng step của lượt agent - chỉ đọc, không có đường sửa/xóa
  traceAll: () => request<{ turns: TraceTurnAcrossThreads[] }>("/api/traces"),
  traceTurns: (accountId: string, threadId: string) =>
    request<{ turns: TraceTurn[] }>(
      `/api/traces/${encodeURIComponent(accountId)}/${encodeURIComponent(threadId)}`,
    ),
  traceSteps: (turnId: number) => request<{ steps: TraceStep[] }>(`/api/traces/turn/${turnId}`),

  imageGen: () => request<ImageGenSettings>("/api/image-gen"),
  updateImageGen: (update: { baseUrl?: string; model?: string; apiKey?: string }) =>
    request<ImageGenSettings & { ok: true }>("/api/image-gen", {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  // Vẽ thật 1 ảnh nên chậm (~1 phút) và tốn tiền - UI phải nói trước
  testImageGen: () =>
    request<{ ok: boolean; kb?: number; ext?: string; error?: string }>("/api/image-gen/test", {
      method: "POST",
    }),
  clearImageGen: () => request<ImageGenSettings & { ok: true }>("/api/image-gen", { method: "DELETE" }),

  schedule: {
    list: (accountId: string) =>
      request<{ items: ScheduledJobItem[]; timezone: string }>(
        `/api/schedule?accountId=${encodeURIComponent(accountId)}`,
      ),
    create: (input: {
      accountId: string;
      threadId: string;
      threadType: number;
      name: string;
      kind: ScheduledJobKind;
      payload: string;
      schedule: ScheduleInputPayload;
    }) =>
      request<{ job: ScheduledJobItem; timezone: string }>("/api/schedule", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (
      id: string,
      accountId: string,
      threadId: string,
      patch: { name?: string; payload?: string; schedule?: ScheduleInputPayload; enabled?: boolean },
    ) =>
      request<{ job: ScheduledJobItem; timezone: string }>(`/api/schedule/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ accountId, threadId, ...patch }),
      }),
    remove: (id: string, accountId: string, threadId: string) =>
      request<{ ok: true }>(
        `/api/schedule/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}&threadId=${encodeURIComponent(threadId)}`,
        { method: "DELETE" },
      ),
    run: (id: string, accountId: string, threadId: string) =>
      request<{ run: ScheduledJobRunItem | null }>(`/api/schedule/${encodeURIComponent(id)}/run`, {
        method: "POST",
        body: JSON.stringify({ accountId, threadId }),
      }),
    runs: (id: string, accountId: string, threadId: string) =>
      request<{ runs: ScheduledJobRunItem[] }>(
        `/api/schedule/${encodeURIComponent(id)}/runs?accountId=${encodeURIComponent(accountId)}&threadId=${encodeURIComponent(threadId)}`,
      ),
  },

  provider: () => request<ProviderSettings>("/api/provider"),
  updateProvider: (update: Partial<ProviderSettings> & { apiKey?: string }) =>
    request<ProviderSettings & { ok: true }>("/api/provider", {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  clearProvider: () => request<{ ok: true }>("/api/provider", { method: "DELETE" }),
  testProvider: () =>
    request<{ ok: boolean; reply?: string; error?: string }>("/api/provider/test", {
      method: "POST",
    }),
};

export type ManagedAccount = {
  id: string;
  label: string;
  enabled: boolean;
  agentId: string;
  allowlist: { mode: "all" | "list"; userIds: string[] };
  groupRequireMention: boolean;
  respondToGroups: boolean;
  groupPassiveListen: boolean;
  autoReactEnabled: boolean;
  autoReactIcon: string;
  typingIndicatorEnabled: boolean;
  disabledTools: string[];
  running: boolean;
  hasCredentials: boolean;
};

export type ToolCatalogItem = {
  key: string;
  label: string;
  description: string;
  group: "read" | "action";
  /** Có nút Settings mở modal chuỗi nguồn không */
  hasSettings: boolean;
  /** Hạ tầng đã sẵn sàng chưa (khác bật/tắt per account) - false = model không nhận được tool */
  available: boolean;
  /** Thiếu gì và sửa ở đâu - chỉ có khi available = false */
  unavailableHint?: string;
};

export type SearchSettings = {
  provider: "duckduckgo" | "brave";
  braveApiKeyMasked: string;
  hasBraveApiKey: boolean;
};

export type FetchSettings = { fallbackEnabled: boolean };

export type ReactionIcon = { key: string; emoji: string; label: string };

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh";

/** Một tham số chỉnh được, mô tả lấy thẳng từ backend nên web không chép lại danh mục */
export type TuningDef = {
  group: string;
  label: string;
  hint: string;
} & (
  | { kind: "number"; min: number; max: number; unit?: string }
  | { kind: "boolean" }
  | { kind: "enum"; options: string[] }
  // Danh sách chọn dựng ở trình duyệt bằng Intl.supportedValuesOf("timeZone")
  // thay vì gửi 418 tên zone qua JSON mỗi lần mở trang
  | { kind: "timezone" }
);

export type TuningGroup = { id: string; title: string; hint: string; navHint: string };

export type TuningValue = { key: string; value: number | boolean | string; fromEnv: boolean };

export type ManagedAgent = {
  id: string;
  icon: string;
  name: string;
  persona: string;
  modelProvider: "openai-compatible" | "anthropic" | null;
  modelName: string | null;
  maxSteps: number | null;
  /** Mức suy nghĩ riêng; null = theo mức mặc định ở trang Cấu hình */
  reasoningEffort: ReasoningEffort | null;
  /** Tool agent này KHÔNG dùng - GIAO với danh sách tắt của account */
  disabledTools: string[];
  /** Trần token phần input; null = theo LLM_CONTEXT_WINDOW ở trang Cấu hình */
  contextWindow: number | null;
  isDefault: boolean;
  accountCount: number;
};

export type MemoryFactItem = {
  id: number;
  accountId: string;
  subjectId: string;
  content: string;
  learnedInThreadId: string;
  learnedInGroup: boolean;
  createdAt: string;
};

export type ProviderSettings = {
  provider: "openai-compatible" | "anthropic";
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  hasOverride: boolean;
};

export type VisionSettings = {
  /** Model chính có đọc được ảnh không: auto = tự hỏi router */
  mode: "auto" | "on" | "off";
  sidecar: {
    baseUrl: string;
    model: string;
    apiKeyMasked: string;
    /** apiKeyMasked trống vẫn ra chuỗi "chưa cấu hình" nên phải có cờ riêng */
    hasApiKey: boolean;
    configured: boolean;
  };
  /**
   * Chế độ ảnh đang hiệu lực: native = model tự đọc, describe = sidecar mô tả,
   * hybrid = combo nhận cả pixel + mô tả, blind = bỏ ảnh
   */
  imageMode: "native" | "describe" | "hybrid" | "blind";
};

/** Một lượt agent trong danh sách trace */
export type TraceTurn = {
  id: number;
  totalTokens: number;
  steps: number;
  /** Số step THỰC SỰ có trace - lệch với `steps` nghĩa là trace bị tắt giữa chừng */
  stepCount: number;
  createdAt: string;
};

/** Một dòng log. `level` là SỐ theo quy ước pino: 20 debug, 30 info, 40 warn, 50 error */
export type LogEntry = {
  time: number;
  level: number;
  scope: string;
  msg: string;
  /** Trường phụ (threadId, accountId, err...) - chỗ chứa ngữ cảnh */
  fields: Record<string, unknown>;
};

export type LogsResponse = {
  entries: LogEntry[];
  /** Scope có trong log - dựng ô lọc từ đây, không hardcode */
  scopes: string[];
  /** true khi LOG_FILE_ENABLED tắt: không có file để đọc */
  disabled: boolean;
  hint?: string;
};

/** Lượt agent kèm thông tin hội thoại - cho trang Trace gộp mọi hội thoại */
export type TraceTurnAcrossThreads = TraceTurn & {
  accountId: string;
  threadId: string;
  /** Tên hội thoại, rơi về threadId khi chưa có tên */
  displayName: string;
};

/** Một step trong lượt agent: model nói gì, gọi tool nào với tham số gì */
export type TraceStep = {
  stepNumber: number;
  /**
   * Lần chạy thứ mấy trong cùng lượt. > 1 nghĩa là bot đã phải chạy lại (router
   * trả rỗng, hoặc dựng lại input không kèm ảnh) - step đánh số lại từ 1 nên
   * không có trường này thì trace đọc ra 1,1,2,2,3,3 trông như model lặp.
   */
  attempt: number;
  text: string;
  /** Rỗng với model không phơi chuỗi suy nghĩ (OpenAI); có với DeepSeek */
  reasoning: string;
  toolCalls: { name: string; input: string }[];
  /** `hong` do `summarizeStep` gắn - nhánh HỎNG của tool, không phải kết quả thường */
  toolResults: { name: string; output: string; hong?: boolean }[];
  /** Tool chạy lỗi - SDK để ở content, không vào toolResults nên từng bị mù hẳn */
  toolErrors: { name: string; error: string }[];
  finishReason: string;
  /** Nhà cung cấp báo tham số bị bỏ qua - chỗ hay lộ lỗi âm thầm */
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
};

/**
 * Cấu hình tool vẽ ảnh. Không có trường "mode" như vision vì không tự dò được:
 * /v1/models của router chỉ liệt kê model chat, model vẽ ảnh nằm ở registry
 * riêng nên người dùng phải tự gõ tên model.
 */
export type ImageGenSettings = {
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  /** apiKeyMasked trống vẫn ra chuỗi "chưa cấu hình" nên phải có cờ riêng */
  hasApiKey: boolean;
  configured: boolean;
};

// ===== Lịch hẹn (scheduler) =====

export type ScheduledJobKind = "message" | "agent";
export type ScheduleKind = "once" | "every" | "cron";
export type JobRunStatus = "running" | "ok" | "silent" | "skipped" | "error" | "interrupted";

/** Khớp 1-1 với `ScheduleInput` phía server (`schedule-parser.ts`) - gửi thẳng, không chuyển đổi */
export type ScheduleInputPayload =
  | { kind: "once"; date: string; time: string }
  | { kind: "once"; inMinutes: number }
  | { kind: "every"; minutes: number }
  | { kind: "cron"; expr: string };

export type ScheduledJobItem = {
  id: string;
  accountId: string;
  threadId: string;
  threadType: number;
  name: string;
  kind: ScheduledJobKind;
  payload: string;
  scheduleKind: ScheduleKind;
  runAt: string | null;
  everyMinutes: number | null;
  cronExpr: string | null;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** Gồm cả 'blocked' (chặn ở preflight: account rớt phiên, bot tắt cho thread) - không nằm trong JobRunStatus */
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
  maxRuns: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledJobRunItem = {
  id: number;
  jobId: string;
  /** Link sang trang Trace khi có giá trị (chỉ job kind='agent' mới có) */
  turnId: number | null;
  status: JobRunStatus;
  detail: string;
  deliveredChars: number;
  startedAt: string;
  finishedAt: string | null;
};
