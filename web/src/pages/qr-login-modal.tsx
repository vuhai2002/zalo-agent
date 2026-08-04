import { useEffect, useState } from "react";
import type { ManagedAccount } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";

type QrState = {
  status: "idle" | "starting" | "waiting_scan" | "scanned" | "success" | "declined" | "error" | "timeout";
  qrDataUri?: string;
  error?: string;
};

const STATUS_TEXT: Record<QrState["status"], string> = {
  idle: "Đang chuẩn bị...",
  starting: "Đang tạo mã QR...",
  waiting_scan: "Mở app Zalo trên điện thoại và quét mã này",
  scanned: "Đã quét - xác nhận đăng nhập trên điện thoại",
  success: "Đăng nhập thành công! Bot đang khởi động...",
  declined: "Bạn đã từ chối đăng nhập trên điện thoại",
  error: "Đăng nhập thất bại",
  timeout: "Hết thời gian chờ quét (3 phút)",
};

async function callLogin(accountId: string, path: string, method: string): Promise<QrState> {
  const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/${path}`, { method });
  if (!res.ok) return { status: "error", error: `Lỗi ${res.status}` };
  return (await res.json()) as QrState;
}

/** Modal QR login: POST bắt đầu phiên rồi polling status mỗi 1.5s */
export function QrLoginModal({
  account,
  onClose,
}: {
  account: ManagedAccount;
  onClose: () => void;
}) {
  const [state, setState] = useState<QrState>({ status: "idle" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped) return;
      const next = await callLogin(account.id, "login/status", "GET");
      if (stopped) return;
      setState(next);
      const terminal = ["success", "declined", "error", "timeout"].includes(next.status);
      if (!terminal) timer = setTimeout(poll, 1500);
    };

    void callLogin(account.id, "login", "POST").then((first) => {
      if (stopped) return;
      setState(first);
      timer = setTimeout(poll, 1500);
    });

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [account.id, retryKey]);

  const failed = ["declined", "error", "timeout"].includes(state.status);
  const nen = useChotNen(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]" {...nen}>
      <div className="gc-card w-full max-w-sm p-6 text-center">
        <div className="mb-1 font-semibold text-ink">Login QR - {account.label}</div>
        <p className="mb-4 text-[13px] text-ink-soft">{STATUS_TEXT[state.status]}</p>

        <div className="mx-auto mb-4 flex h-56 w-56 items-center justify-center rounded-xl border border-line bg-surface">
          {state.qrDataUri && state.status === "waiting_scan" ? (
            <img src={state.qrDataUri} alt="Mã QR đăng nhập Zalo" className="h-52 w-52" />
          ) : state.status === "success" ? (
            <span className="text-5xl">✅</span>
          ) : failed ? (
            <span className="text-5xl">⚠️</span>
          ) : state.status === "scanned" ? (
            <span className="text-5xl">📱</span>
          ) : (
            <span className="animate-pulse text-[13px] text-ink-soft">Đang tải QR...</span>
          )}
        </div>

        {state.error && <p className="mb-3 text-[13px] text-red-600 dark:text-red-400">{state.error}</p>}

        <div className="flex justify-center gap-3">
          {failed && (
            <button
              onClick={() => setRetryKey((k) => k + 1)}
              className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600"
            >
              Thử lại
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-[14px] text-ink hover:bg-tile"
          >
            {state.status === "success" ? "Xong" : "Đóng"}
          </button>
        </div>
      </div>
    </div>
  );
}
