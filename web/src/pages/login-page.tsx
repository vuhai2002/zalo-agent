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
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zalo-500 font-bold text-white">
            Z
          </span>
          <span className="text-xl font-semibold text-slate-900">zalo-agent</span>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">Mật khẩu dashboard</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-zalo-500 focus:ring-2 focus:ring-zalo-100"
        />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="w-full rounded-lg bg-zalo-500 py-2 text-sm font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
        >
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
