import { useEffect, useState } from "react";
import type { ProviderSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useConfirmDialog } from "../shared/confirm-dialog";

export type ProviderForm = { provider: string; baseUrl: string; model: string; apiKey: string };
export type TrangThai = { tone: "green" | "red"; text: string } | null;

/**
 * Trạng thái + ba lời gọi API của form nhà cung cấp LLM (lưu, test kết nối,
 * xóa). Tách khỏi `providers-section.tsx` để file kia còn đúng phần hiển thị.
 */
export function useProviderForm() {
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [form, setForm] = useState<ProviderForm>({
    provider: "openai-compatible",
    baseUrl: "",
    model: "",
    apiKey: "",
  });
  const [status, setStatus] = useState<TrangThai>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = () =>
    api.provider().then((s) => {
      setSettings(s);
      setForm({ provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey: "" });
    });

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      await api.updateProvider({
        provider: form.provider as ProviderSettings["provider"],
        baseUrl: form.baseUrl || undefined,
        model: form.model,
        apiKey: form.apiKey || undefined,
      });
      await load();
      setStatus({ tone: "green", text: "Đã lưu - áp dụng từ lượt agent kế tiếp, không cần restart" });
    } catch (err) {
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Lưu thất bại" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus(null);
    const result = await api.testProvider().catch((err) => ({
      ok: false as const,
      error: err instanceof ApiError ? err.message : "Không gọi được",
      reply: undefined,
    }));
    setStatus(
      result.ok
        ? { tone: "green", text: `Kết nối ok - model trả lời: "${result.reply}"` }
        : { tone: "red", text: `Kết nối lỗi: ${result.error}` },
    );
    setBusy(false);
  }

  async function reset() {
    // Hành động PHÁ HỦY: `clearLlmSettings` xóa cả API key. Từ khi .env rút còn
    // 9 biến, phần LLM ở đó thường trống - nên không có bản dự phòng nào để
    // "quay về", bấm nhầm là bot câm ngay lượt sau. Mọi hành động phá hủy khác
    // trong dashboard đều hỏi trước; chỗ này trước đó thì không.
    const ok = await confirm({
      title: "Xóa toàn bộ cấu hình LLM?",
      message:
        "API key, base URL và tên model đã lưu sẽ bị xóa. Nếu máy chủ không đặt sẵn cấu hình LLM bằng biến môi trường thì bot ngừng trả lời cho tới khi bạn nhập lại.",
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.clearProvider();
      await load();
      setStatus({ tone: "green", text: "Đã xóa cấu hình LLM đã lưu" });
    } catch (err) {
      // Thiếu `finally` là lỗi cũ ở đúng hàm này: request hỏng thì `busy` kẹt
      // `true` và cả ba nút Lưu/Test/Xóa không bấm được nữa cho tới khi F5
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Xóa thất bại" });
    } finally {
      setBusy(false);
    }
  }

  return { settings, form, setForm, status, busy, save, test, reset, confirmDialog };
}
