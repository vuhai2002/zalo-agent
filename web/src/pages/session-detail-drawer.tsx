import { useEffect, useState } from "react";
import type { MessageItem, ThreadItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { formatTime } from "../shared/ui-bits";
import { SessionTraceView } from "./session-trace-view";

/**
 * Drawer trượt từ phải: xem hội thoại của 1 thread, nút tải thêm tin cũ hơn.
 * Tab "Trace" xem lại từng step agent đã chạy - dùng khi bot trả lời sai và cần
 * biết nó đã gọi tool nào với tham số gì.
 */
export function SessionDetailDrawer({
  thread,
  onClose,
}: {
  thread: ThreadItem;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [tab, setTab] = useState<"chat" | "trace">("chat");

  useEffect(() => {
    api.threadMessages(thread.accountId, thread.threadId).then((data) => {
      setMessages(data.items);
      setHasOlder(data.items.length >= 50);
    });
  }, [thread.accountId, thread.threadId]);

  const nen = useChotNen(onClose);

  async function loadOlder() {
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    const data = await api.threadMessages(thread.accountId, thread.threadId, oldestId);
    setMessages((prev) => [...data.items, ...prev]);
    setHasOlder(data.items.length >= 50);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25 backdrop-blur-[2px]" {...nen}>
      <div className="flex h-full w-full max-w-lg flex-col border-l border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="font-semibold text-ink">{thread.displayName || thread.threadId}</div>
            <div className="text-[12px] text-ink-soft">
              {thread.messageCount} tin - {thread.usage.totalTokens.toLocaleString("vi-VN")} token
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile"
          >
            Đóng
          </button>
        </div>

        <div className="flex gap-1 border-b border-line px-5 pt-2">
          {(
            [
              ["chat", "Hội thoại"],
              ["trace", "Trace agent"],
            ] as const
          ).map(([key, nhan]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                tab === key
                  ? "border-b-2 border-zalo-500 text-zalo-700"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {nhan}
            </button>
          ))}
        </div>

        {tab === "trace" && (
          <div className="flex-1 overflow-y-auto bg-canvas px-5 py-4">
            <SessionTraceView accountId={thread.accountId} threadId={thread.threadId} />
          </div>
        )}

        {tab === "chat" && thread.summary && (
          <div className="border-b border-line bg-zalo-50/70 px-5 py-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zalo-700">
              Tóm tắt phần hội thoại cũ
            </div>
            <p className="text-[12px] leading-relaxed text-ink-soft">{thread.summary}</p>
          </div>
        )}

        <div
          className={`flex-1 space-y-3 overflow-y-auto bg-canvas px-5 py-4 ${tab === "chat" ? "" : "hidden"}`}
        >
          {hasOlder && (
            <button
              onClick={loadOlder}
              className="mx-auto block rounded-full border border-line bg-surface px-4 py-1 text-[12px] text-ink-soft hover:bg-tile"
            >
              Tải tin cũ hơn
            </button>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "assistant" ? "flex justify-end" : "flex"}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-[14px] ${
                  m.role === "assistant"
                    ? "rounded-br-md bg-zalo-500 text-white"
                    : "rounded-bl-md border border-line bg-surface text-ink"
                }`}
              >
                {m.role === "user" && m.senderName && (
                  <div className="mb-0.5 text-[12px] font-medium text-zalo-600">{m.senderName}</div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                <div
                  className={`mt-1 text-right text-[10px] ${
                    m.role === "assistant" ? "text-white/70" : "text-ink-soft/60"
                  }`}
                >
                  {formatTime(m.createdAt)}
                </div>
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="py-10 text-center text-[14px] text-ink-soft/60">Chưa có tin nhắn</p>
          )}
        </div>
      </div>
    </div>
  );
}
