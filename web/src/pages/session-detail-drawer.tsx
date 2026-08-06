import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MessageItem, ThreadItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { useConfirmDialog } from "../shared/confirm-dialog";
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
  onDoiDuLieu,
}: {
  thread: ThreadItem;
  onClose: () => void;
  /** Gọi khi dữ liệu thread đổi (xóa ngữ cảnh) để danh sách ngoài tải lại */
  onDoiDuLieu?: () => void;
}) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [tab, setTab] = useState<"chat" | "trace">("chat");
  // Giữ bản sao cục bộ để xóa xong khối biến mất ngay, không phải tải lại cả trang
  const [tomTat, setTomTat] = useState(thread.summary);
  const [moTomTat, setMoTomTat] = useState(false);
  const [dangXoa, setDangXoa] = useState(false);
  // Ô tick RIÊNG chứ không gộp vào hộp xác nhận: trí nhớ gắn với con người, xóa
  // nó là một quyết định khác hẳn xóa lịch sử, phải chọn có ý thức trước khi bấm
  const [cungXoaTriNho, setCungXoaTriNho] = useState(false);
  const [dangXoaNguCanh, setDangXoaNguCanh] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  useEffect(() => {
    api.threadMessages(thread.accountId, thread.threadId).then((data) => {
      setMessages(data.items);
      setHasOlder(data.items.length >= 50);
    });
  }, [thread.accountId, thread.threadId]);

  const nen = useChotNen(onClose);

  const khungCuon = useRef<HTMLDivElement>(null);
  const daCuonLanDau = useRef(false);
  /** Khoảng cách từ đáy TRƯỚC khi chèn tin cũ - dùng để trả về đúng chỗ đang đọc */
  const giuKhoangDay = useRef<number | null>(null);

  /**
   * Cuộn như một khung chat thật: mở ra là ở TIN MỚI NHẤT, lướt lên mới thấy
   * tin cũ.
   *
   * Bản đầu không cuộn gì cả nên khung đứng ở `scrollTop = 0`, tức tin CŨ NHẤT
   * trong 50 tin vừa nạp - mở hội thoại ra thấy chuyện của mấy hôm trước.
   *
   * `useLayoutEffect` chứ không phải `useEffect`: chạy trước lượt vẽ nên không
   * thấy khung nháy ở đầu danh sách rồi mới nhảy xuống.
   */
  useLayoutEffect(() => {
    const el = khungCuon.current;
    if (!el || messages.length === 0) return;

    // Vừa chèn tin cũ lên đầu: giữ nguyên chỗ đang đọc. Không giữ thì màn hình
    // nhảy vọt đúng lúc người ta đang đọc dở.
    if (giuKhoangDay.current !== null) {
      el.scrollTop = el.scrollHeight - giuKhoangDay.current;
      giuKhoangDay.current = null;
      return;
    }

    if (!daCuonLanDau.current) {
      daCuonLanDau.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function xoaTomTat() {
    const ok = await confirm({
      title: "Xóa bản tóm tắt này?",
      message:
        "Tin nhắn KHÔNG bị xóa. Bot sẽ tự viết lại bản tóm tắt từ đầu ở lần gộp tiếp theo, nên nó tốn thêm một lượt gọi model.",
    });
    if (!ok) return;
    setDangXoa(true);
    try {
      await api.xoaTomTatThread(thread.accountId, thread.threadId);
      setTomTat("");
    } finally {
      setDangXoa(false);
    }
  }

  async function xoaNguCanh() {
    const ok = await confirm({
      title: "Xóa sạch ngữ cảnh cuộc trò chuyện này?",
      message:
        "Toàn bộ tin nhắn, bản tóm tắt, trace từng bước và ảnh đã tải của cuộc trò chuyện này sẽ bị xóa. " +
        (cungXoaTriNho
          ? "KÈM những điều bot đã ghi nhớ về người này học được TRONG cuộc trò chuyện này. "
          : "Bot vẫn giữ những điều đã ghi nhớ về người này. ") +
        "Lịch hẹn đang chờ vẫn giữ nguyên. Không hoàn tác được.",
    });
    if (!ok) return;
    setDangXoaNguCanh(true);
    try {
      await api.xoaNguCanhThread(thread.accountId, thread.threadId, cungXoaTriNho);
      setMessages([]);
      setTomTat("");
      setHasOlder(false);
      onDoiDuLieu?.();
    } finally {
      setDangXoaNguCanh(false);
    }
  }

  async function loadOlder() {
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    // Đo TRƯỚC khi chèn: khoảng cách tới đáy là thứ duy nhất không đổi khi
    // chiều cao danh sách tăng lên.
    const el = khungCuon.current;
    giuKhoangDay.current = el ? el.scrollHeight - el.scrollTop : null;
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

        {/*
          Khối này là ANH EM cùng cấp với danh sách tin trong flex column, nên
          chiều cao của nó ăn thẳng vào chỗ của danh sách. Bản đầu không có trần
          lẫn `overflow`: một bản tóm tắt 300 từ nở ra ~460px, đẩy phần hội thoại
          xuống còn một mẩu và chính nó cũng không cuộn được. Vì vậy mặc định thu
          gọn 2 dòng, mở ra thì có trần chiều cao và tự cuộn bên trong.
        */}
        {tab === "chat" && tomTat && (
          <div className="border-b border-line bg-zalo-50/70 px-5 py-3">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zalo-700">
                Tóm tắt phần hội thoại cũ
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMoTomTat((v) => !v)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-zalo-700 hover:bg-zalo-100"
                >
                  {moTomTat ? "Thu gọn" : "Xem đủ"}
                </button>
                <button
                  type="button"
                  onClick={xoaTomTat}
                  disabled={dangXoa}
                  className="rounded px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  {dangXoa ? "Đang xóa..." : "Xóa"}
                </button>
              </div>
            </div>
            <p
              className={`text-[12px] leading-relaxed text-ink-soft ${
                moTomTat ? "max-h-40 overflow-y-auto pr-1" : "line-clamp-2"
              }`}
            >
              {tomTat}
            </p>
          </div>
        )}

        <div
          ref={khungCuon}
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

        {/* Chân drawer - chỉ ở tab Chat, vì đây là thao tác lên chính hội thoại.
            Ô tick đứng TRƯỚC nút: người dùng phải thấy lựa chọn trí nhớ trước
            khi bấm, chứ không phải đọc nó trong hộp xác nhận rồi mới quay ra. */}
        {tab === "chat" && (
          <div className="border-t border-line bg-surface px-5 py-3">
            <label className="mb-2 flex cursor-pointer items-start gap-2 text-[12px] leading-snug text-ink-soft">
              <input
                type="checkbox"
                checked={cungXoaTriNho}
                onChange={(e) => setCungXoaTriNho(e.target.checked)}
                className="mt-0.5 cursor-pointer accent-rose-600"
              />
              <span>Xóa luôn những điều bot đã ghi nhớ học được trong cuộc trò chuyện này</span>
            </label>
            <button
              type="button"
              onClick={xoaNguCanh}
              disabled={dangXoaNguCanh}
              className="rounded-lg border border-rose-200 dark:border-rose-900 px-3 py-1.5 text-[13px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
            >
              {dangXoaNguCanh ? "Đang xóa..." : "Xóa sạch ngữ cảnh"}
            </button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft/70">
              Bot quên hẳn cuộc trò chuyện này và bắt đầu lại từ đầu. Lịch hẹn đang chờ vẫn giữ.
            </p>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
