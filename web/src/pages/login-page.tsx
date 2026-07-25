import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../dashboard-api-client";

export function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không kết nối được server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4">
      <form onSubmit={submit} className="gc-card w-full max-w-sm p-8">
        <div className="mb-7 flex flex-col items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zalo-500 text-xl font-bold text-white">
            Z
          </span>
          <div className="text-center">
            <div className="text-lg font-bold text-ink">zalo-agent</div>
            <div className="text-[13px] text-ink-soft">Dashboard quản trị bot</div>
          </div>
        </div>

        <label className="mb-1.5 block text-[13px] font-medium text-ink">Mật khẩu dashboard</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="gc-input mb-3 w-full"
        />
        {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="w-full rounded-lg bg-zalo-500 py-2.5 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
        >
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
