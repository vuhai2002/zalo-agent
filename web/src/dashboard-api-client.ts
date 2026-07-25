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
    llm: { provider: string; model: string; hasOverride: boolean };
  };
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

  overview: () => request<OverviewData>("/api/overview"),

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

  agentsAdmin: {
    list: () => request<{ items: ManagedAgent[] }>("/api/agents"),
    create: (input: { id: string; name: string; icon?: string; persona?: string }) =>
      request<{ agent: ManagedAgent }>("/api/agents", { method: "POST", body: JSON.stringify(input) }),
    update: (
      id: string,
      patch: Partial<Pick<ManagedAgent, "name" | "icon" | "persona" | "modelProvider" | "modelName" | "maxSteps">>,
    ) =>
      request<{ agent: ManagedAgent }>(`/api/agents/${encodeURIComponent(id)}`, {
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
  running: boolean;
  hasCredentials: boolean;
};

export type ManagedAgent = {
  id: string;
  icon: string;
  name: string;
  persona: string;
  modelProvider: "openai-compatible" | "anthropic" | null;
  modelName: string | null;
  maxSteps: number | null;
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
