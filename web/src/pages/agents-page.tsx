import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ManagedAgent } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconBot, IconPlus } from "../shared/dashboard-icons";
import { AgentCard } from "./agent-card";
import { AgentCreateModal } from "./agent-create-modal";
import { DUONG_DAN_TAO } from "./agent-draft";
import {
  DaiSoLieu,
  ThanhCongCu,
  locAgent,
  sapXepAgent,
  type KieuSapXep,
  type KieuXem,
} from "./agents-toolbar";

/**
 * Danh sách agent. Tạo mở modal 2 ô (nhanh), sửa mở trang riêng `/agents/:id`
 * (đủ chỗ cho model, công cụ, ngân sách token) - xem
 * `plans/260802-1348-agent-chuan-production/phase-01-*`.
 */

/** Nhớ kiểu xem qua các lần vào trang - đổi bố cục xong mà lần sau vào lại từ đầu thì bực */
const KHOA_KIEU_XEM = "zalo-agent:agents-kieu-xem";

function kieuXemDaLuu(): KieuXem {
  try {
    return localStorage.getItem(KHOA_KIEU_XEM) === "danh-sach" ? "danh-sach" : "luoi";
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư) không được làm chết trang
    return "luoi";
  }
}

export function AgentsPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  /** Nhà cung cấp chung - để biết agent nào khai provider LỆCH */
  const [providerChung, setProviderChung] = useState<string | null>(null);
  const [tim, setTim] = useState("");
  const [sapXep, setSapXep] = useState<KieuSapXep>("mac-dinh");
  const [kieuXem, setKieuXem] = useState<KieuXem>(kieuXemDaLuu);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = () =>
    api.agentsAdmin
      .list()
      .then((d) => setAgents(d.items))
      .catch(() => setAgents([]));

  useEffect(() => {
    void reload();
    // Lỗi thì bỏ qua: đây chỉ để hiện cảnh báo, không được làm chết trang
    void api
      .provider()
      .then((p) => setProviderChung(p.provider))
      .catch(() => undefined);
  }, []);

  function doiKieuXem(v: KieuXem) {
    setKieuXem(v);
    try {
      localStorage.setItem(KHOA_KIEU_XEM, v);
    } catch {
      // Không lưu được thì thôi, phiên này vẫn dùng bình thường
    }
  }

  async function remove(agent: ManagedAgent) {
    const ok = await confirm({
      title: `Xóa agent "${agent.name}"?`,
      message: "Persona và cấu hình model riêng của agent này sẽ mất.",
    });
    if (!ok) return;
    setError("");
    try {
      await api.agentsAdmin.remove(agent.id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xóa thất bại");
    }
  }

  const hienThi = useMemo(() => sapXepAgent(locAgent(agents, tim), sapXep), [agents, tim, sapXep]);
  const tongAccount = agents.reduce((n, a) => n + a.accountCount, 0);

  return (
    <div>
      <PageHeader
        icon={IconBot}
        title="Agents"
        subtitle="Mỗi agent là một bộ não: persona + model riêng, gắn vào tài khoản Zalo ở trang Accounts"
        aside={
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600"
          >
            <IconPlus size={17} />
            Tạo agent
          </button>
        }
      />

      {error && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{error}</p>}

      <DaiSoLieu soAgent={agents.length} soAccount={tongAccount} />

      {/* Thanh công cụ chỉ hiện từ 2 agent trở lên: tìm kiếm và sắp xếp trên
          đúng một mục là ba control không làm được gì */}
      {agents.length > 1 && (
        <ThanhCongCu
          tim={tim}
          onTim={setTim}
          sapXep={sapXep}
          onSapXep={setSapXep}
          kieuXem={kieuXem}
          onKieuXem={doiKieuXem}
        />
      )}

      {hienThi.length === 0 && (
        <p className="rounded-2xl border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-soft/70">
          {agents.length === 0 ? "Chưa có agent nào." : `Không có agent nào khớp "${tim}".`}
        </p>
      )}

      {hienThi.length > 0 &&
        (kieuXem === "danh-sach" ? (
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {hienThi.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                providerChung={providerChung}
                danhSach
                onSua={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                onXoa={() => void remove(agent)}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {hienThi.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                providerChung={providerChung}
                danhSach={false}
                onSua={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                onXoa={() => void remove(agent)}
              />
            ))}
          </div>
        ))}

      {creating && (
        <AgentCreateModal
          onClose={() => setCreating(false)}
          idDangCo={agents.map((a) => a.id)}
          // Modal chỉ thu thập; agent sinh ra khi bấm Tạo ở trang kia
          onTiepTuc={(banNhap) => navigate(DUONG_DAN_TAO, { state: banNhap })}
        />
      )}

      {confirmDialog}
    </div>
  );
}
