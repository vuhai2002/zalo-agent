import type { AgentProfile } from "../config/agent-store.js";

/**
 * `AgentProfile` giả cho test dựng `ToolContext`.
 *
 * Có từ khi agent trở thành MỘT TRONG HAI lớp quyết định tool nào được cấp
 * (`ToolScope` ở `tool-registry.ts`): mọi test chạm tool đều phải mang theo một
 * agent, và chép 12 dòng literal vào từng file là mời gọi drift.
 *
 * `import type` nên KHÔNG kéo `agent-store.js` vào lúc chạy - module đó chạm DB
 * ở module scope, import thật ở đây sẽ phá bẫy "gọi setupTestEnv() xong mới
 * import động" đã ghi trong CLAUDE.md.
 *
 * Mặc định KHÔNG tắt tool nào: test nào cần lớp agent lọc thì truyền tường minh,
 * để đọc test là thấy ngay nó đang kiểm lớp nào.
 */
export function fakeAgentProfile(patch: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-test",
    icon: "🤖",
    name: "Agent test",
    persona: "",
    modelProvider: null,
    modelName: null,
    maxSteps: null,
    reasoningEffort: null,
    disabledTools: [],
    contextWindow: null,
    isDefault: false,
    ...patch,
  };
}
