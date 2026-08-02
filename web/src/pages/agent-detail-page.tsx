import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ManagedAgent, ProviderSettings, ReasoningEffort } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconBot } from "../shared/dashboard-icons";
import { AgentIdentitySection, type AgentIdentityForm } from "./agent-identity-section";
import { AgentModelSection, type AgentModelForm } from "./agent-model-section";

type Form = AgentIdentityForm & AgentModelForm;

const tuAgent = (a: ManagedAgent): Form => ({
  icon: a.icon,
  name: a.name,
  persona: a.persona,
  modelProvider: a.modelProvider ?? "",
  modelName: a.modelName ?? "",
  // Chuỗi rỗng = "theo cấu hình chung"; gửi lên thành null
  maxSteps: a.maxSteps == null ? "" : String(a.maxSteps),
  reasoningEffort: a.reasoningEffort ?? "",
});

/**
 * Trang sửa một agent. Tách khỏi màn TẠO (`agent-create-modal.tsx`) vì hai việc
 * khác nhịp: tạo cần nhanh, sửa cần đủ chỗ cho model, công cụ (phase sau) và
 * ngân sách token.
 *
 * Cố ý dùng nút "Lưu thay đổi" chứ KHÔNG tự lưu như trang Cấu hình: ở đó mỗi ô
 * là một thiết lập độc lập, còn ở đây cả trang là MỘT bản ghi - `updateAgent`
 * ghi trọn dòng, nên lưu từng ô sẽ ghi đè cả những ô người dùng đang sửa dở.
 */
export function AgentDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<ManagedAgent | null>(null);
  const [chung, setChung] = useState<ProviderSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState("");
  const [daLuu, setDaLuu] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let huy = false;
    // Không có `GET /api/agents/:id` nên lọc từ danh sách - tránh đổi backend
    // chỉ để phục vụ một trang. Số agent luôn nhỏ (vài cái), không đáng thêm route.
    api.agentsAdmin
      .list()
      .then((d) => {
        if (huy) return;
        const tim = d.items.find((a) => a.id === id) ?? null;
        setAgent(tim);
        setForm(tim ? tuAgent(tim) : null);
      })
      .catch(() => !huy && setAgent(null))
      .finally(() => !huy && setDangTai(false));
    api.provider().then((s) => !huy && setChung(s)).catch(() => undefined);
    return () => {
      huy = true;
    };
  }, [id]);

  const doi = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDaLuu(false);
    setLoi("");
  };

  const banDau = agent ? tuAgent(agent) : null;
  const coDoi = Boolean(form && banDau && JSON.stringify(form) !== JSON.stringify(banDau));

  async function luu() {
    if (!form || !agent) return;
    const soBuoc = form.maxSteps.trim();
    if (soBuoc !== "" && !Number.isFinite(Number(soBuoc))) {
      setLoi("Số bước tối đa phải là một số");
      return;
    }
    setBusy(true);
    setLoi("");
    try {
      const { agent: moi } = await api.agentsAdmin.update(agent.id, {
        icon: form.icon,
        name: form.name.trim(),
        persona: form.persona,
        modelProvider: form.modelProvider === "" ? null : form.modelProvider,
        modelName: form.modelName.trim() === "" ? null : form.modelName.trim(),
        maxSteps: soBuoc === "" ? null : Number(soBuoc),
        reasoningEffort: form.reasoningEffort === "" ? null : (form.reasoningEffort as ReasoningEffort),
      });
      setAgent(moi);
      setForm(tuAgent(moi));
      setDaLuu(true);
    } catch (err) {
      setLoi(err instanceof ApiError ? err.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  if (dangTai) return <p className="text-ink-soft">Đang tải...</p>;

  if (!agent || !form) {
    return (
      <div>
        <PageHeader icon={IconBot} title="Không tìm thấy agent" subtitle={`Không có agent nào mang id "${id}"`} />
        <Link to="/agents" className="text-[14px] text-zalo-600 hover:underline dark:text-zalo-400">
          Quay lại danh sách agent
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={IconBot}
        title={form.name || agent.id}
        subtitle={
          agent.accountCount > 0
            ? `${agent.accountCount} tài khoản Zalo đang dùng agent này`
            : "Chưa tài khoản nào dùng agent này"
        }
        aside={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/agents")}
              className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-tile"
            >
              Quay lại
            </button>
            <button
              type="button"
              onClick={luu}
              disabled={busy || !coDoi || form.name.trim() === ""}
              className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
            >
              {busy ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        }
      />

      {loi && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{loi}</p>}
      {daLuu && !coDoi && (
        <p className="mb-4 text-[13px] text-emerald-600 dark:text-emerald-400">Đã lưu thay đổi.</p>
      )}

      <div className="space-y-5">
        <AgentIdentitySection
          id={agent.id}
          isDefault={agent.isDefault}
          form={form}
          onChange={doi}
        />
        <AgentModelSection form={form} chung={chung} onChange={doi} />
      </div>
    </div>
  );
}
