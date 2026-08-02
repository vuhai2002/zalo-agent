import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ManagedAgent, ProviderSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconBot } from "../shared/dashboard-icons";
import { kiemForm, thanhPatch, tuAgent, type AgentDetailForm } from "./agent-detail-form";
import { AgentIdentitySection } from "./agent-identity-section";
import { AgentModelSection } from "./agent-model-section";
import { AgentToolsSection } from "./agent-tools-section";

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
  const [form, setForm] = useState<AgentDetailForm | null>(null);
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState("");
  const [daLuu, setDaLuu] = useState(false);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

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

  const doi = (patch: Partial<AgentDetailForm>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDaLuu(false);
    setLoi("");
  };

  const banDau = agent ? tuAgent(agent) : null;
  const coDoi = Boolean(form && banDau && JSON.stringify(form) !== JSON.stringify(banDau));

  /**
   * Rời trang khi còn thay đổi chưa lưu thì phải hỏi. Ô persona nhận tới 8000
   * ký tự - mất trắng vì lỡ bấm "Quay lại" là mất thật.
   */
  async function roiTrang() {
    if (coDoi) {
      const ok = await confirm({
        title: "Rời trang mà chưa lưu?",
        message: "Những thay đổi bạn vừa sửa trên trang này sẽ mất.",
        confirmLabel: "Rời đi",
        cancelLabel: "Ở lại",
      });
      if (!ok) return;
    }
    navigate("/agents");
  }

  async function luu() {
    if (!form || !agent) return;
    // Kiểm bằng đúng luật của `patchSchema` phía server. Chốt cũ
    // `!Number.isFinite(...)` là code chết: ô lúc đó là type="number" nên trình
    // duyệt đã nuốt chữ rác thành rỗng trước khi tới đây, `Number("")` ra 0 chứ
    // không bao giờ ra NaN. Hai ca thật (99 và 1.5) thì không ai chặn.
    const loiForm = kiemForm(form);
    if (loiForm) {
      setLoi(loiForm);
      return;
    }
    setBusy(true);
    setLoi("");
    try {
      const { agent: moi } = await api.agentsAdmin.update(agent.id, thanhPatch(form));
      // `accountCount` do `listAgents` tính bằng subquery, PATCH trả về bản ghi
      // THÔ nên không có cột đó. Tin thẳng response sẽ làm dòng phụ đề lật thành
      // "Chưa tài khoản nào dùng" ngay sau khi bấm Lưu, tới khi F5 mới đúng lại.
      setAgent((cu) => ({ ...moi, accountCount: cu?.accountCount ?? 0 }));
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
        <Link to="/agents" className="text-[14px] text-zalo-600 hover:underline">
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
              onClick={roiTrang}
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
        <AgentToolsSection
          disabledTools={form.disabledTools}
          onChange={(disabledTools) => doi({ disabledTools })}
        />
      </div>

      {confirmDialog}
    </div>
  );
}
