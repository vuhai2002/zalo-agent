import { useEffect, useState } from "react";
import type { MessageItem, ThreadItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { formatTime } from "../shared/ui-bits";

/** Drawer trượt từ phải: xem hội thoại của 1 thread, nút tải thêm tin cũ hơn */
export function SessionDetailDrawer({
  thread,
  onClose,
}: {
  thread: ThreadItem;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [hasOlder, setHasOlder] = useState(false);

  useEffect(() => {
    api.threadMessages(thread.accountId, thread.threadId).then((data) => {
      setMessages(data.items);
      setHasOlder(data.items.length >= 50);
    });
  }, [thread.accountId, thread.threadId]);

  async function loadOlder() {
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    const data = await api.threadMessages(thread.accountId, thread.threadId, oldestId);
    setMessages((prev) => [...data.items, ...prev]);
    setHasOlder(data.items.length >= 50);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="font-semibold text-slate-900">{thread.displayName || thread.threadId}</div>
            <div className="text-xs text-slate-400">
              {thread.messageCount} tin - {thread.usage.totalTokens.toLocaleString("vi-VN")} token
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100">
            Đóng
          </button>
        </div>

        {thread.summary && (
          <div className="border-b border-slate-100 bg-zalo-50 px-5 py-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zalo-700">
              Tóm tắt phần hội thoại cũ
            </div>
            <p className="text-xs leading-relaxed text-slate-600">{thread.summary}</p>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {hasOlder && (
            <button
              onClick={loadOlder}
              className="mx-auto block rounded-full border border-slate-200 px-4 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              Tải tin cũ hơn
            </button>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "assistant" ? "flex justify-end" : "flex"}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  m.role === "assistant"
                    ? "bg-zalo-500 text-white"
                    : "bg-slate-100 text-slate-800"
                }`}
              >
                {m.role === "user" && m.senderName && (
                  <div className="mb-0.5 text-xs font-medium opacity-70">{m.senderName}</div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                <div
                  className={`mt-1 text-right text-[10px] ${
                    m.role === "assistant" ? "text-white/70" : "text-slate-400"
                  }`}
                >
                  {formatTime(m.createdAt)}
                </div>
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-400">Chưa có tin nhắn</p>
          )}
        </div>
      </div>
    </div>
  );
}
