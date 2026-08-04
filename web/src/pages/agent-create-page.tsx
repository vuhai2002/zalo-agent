import { useCallback, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconBot } from "../shared/dashboard-icons";
import { useUnsavedChangesPrompt } from "../shared/use-unsaved-changes-prompt";
import { kiemForm, thanhPatch, type AgentDetailForm } from "./agent-detail-form";
import { canPatchSauKhiTao, tuBanNhap, type BanNhapAgent } from "./agent-draft";
import { AgentFormLayout } from "./agent-form-layout";
import { kiemDinhDangId } from "./agent-id-field";
import { AgentIdentitySection } from "./agent-identity-section";

/**
 * Bước 2 của việc tạo agent: cùng bố cục với trang sửa, nhưng CHƯA có gì trong
 * DB. Bấm "Tạo agent" mới ghi, bấm "Hủy" là bỏ hẳn.
 *
 * Bản nhập đi qua state của router chứ không qua URL: id chưa chốt (còn sửa
 * được ngay trên trang này) nên nhét vào đường dẫn là tự mâu thuẫn. Đổi lại,
 * F5 giữa chừng là mất bản nhập - nên vào thẳng đường dẫn này mà không có bản
 * nhập thì đá về danh sách thay vì hiện một form rỗng không rõ đang tạo cái gì.
 */
export function AgentCreatePage() {
  const navigate = useNavigate();
  const banNhap = useLocation().state as BanNhapAgent | null;
  if (!banNhap?.id) return <Navigate to="/agents" replace />;
  return (
    <ManTao
      banNhap={banNhap}
      // Tạo xong về thẳng danh sách: mọi thứ đã lưu rồi, đứng lại ở trang sửa
      // chỉ tổ mời người ta bấm "Lưu thay đổi" một lần nữa cho cùng nội dung.
      // `replace` để nút Back không quay lại màn tạo của agent vừa tạo xong.
      onXong={() => navigate("/agents", { replace: true })}
    />
  );
}

function ManTao({ banNhap, onXong }: { banNhap: BanNhapAgent; onXong: () => void }) {
  const navigate = useNavigate();
  const [id, setId] = useState(banNhap.id);
  const [form, setForm] = useState<AgentDetailForm>(() => tuBanNhap(banNhap));
  const [loi, setLoi] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const doi = (patch: Partial<AgentDetailForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setLoi("");
  };

  /**
   * Luôn hỏi khi rời trang: ở đây KHÔNG có bản gốc để so, mọi thứ trên màn hình
   * đều là thứ chưa từng được ghi. Rời đi là mất sạch, kể cả khi chưa gõ thêm
   * chữ nào so với lúc sang từ modal.
   */
  const hoiRoiTrang = useCallback(
    () =>
      confirm({
        title: "Bỏ agent đang tạo?",
        message: "Agent này chưa được tạo. Rời đi là mất những gì bạn vừa nhập.",
        confirmLabel: "Bỏ",
        cancelLabel: "Ở lại",
        tone: "normal",
      }),
    [confirm],
  );

  useUnsavedChangesPrompt(!busy, hoiRoiTrang);

  async function huy() {
    if (!(await hoiRoiTrang())) return;
    navigate("/agents");
  }

  async function tao() {
    const loiId = kiemDinhDangId(id) || (id.trim() === "" ? "ID không được để trống" : "");
    if (loiId) return setLoi(loiId);
    const loiForm = kiemForm(form);
    if (loiForm) return setLoi(loiForm);

    setBusy(true);
    setLoi("");
    try {
      const { agent } = await api.agentsAdmin.create({
        id,
        name: form.name.trim(),
        icon: form.icon,
        persona: form.persona,
      });
      // POST không nhận model override lẫn tool tắt - xem `canPatchSauKhiTao`.
      // PATCH hỏng ở đây (vd trần context phạm ràng buộc chéo) thì agent ĐÃ tồn
      // tại: đẩy người dùng sang trang sửa kèm câu lỗi, chứ đứng lại đây thì
      // bấm Tạo lần nữa chỉ nhận 409 và không còn đường ra.
      if (canPatchSauKhiTao(form)) {
        try {
          await api.agentsAdmin.update(agent.id, thanhPatch(form));
        } catch (err) {
          navigate(`/agents/${encodeURIComponent(agent.id)}`, {
            replace: true,
            state: { loiSauKhiTao: err instanceof ApiError ? err.message : "Lưu phần model thất bại" },
          });
          return;
        }
      }
      onXong();
    } catch (err) {
      setLoi(err instanceof ApiError ? err.message : "Tạo agent thất bại");
      setBusy(false);
    }
  }

  const chuaDuDe = busy || form.name.trim() === "" || id.trim() === "" || form.icon.trim() === "";

  return (
    <div>
      <PageHeader
        icon={IconBot}
        title={form.name || "Agent mới"}
        subtitle="Chưa tạo - bấm Tạo agent để ghi lại, bấm Hủy là bỏ hẳn"
        aside={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={huy}
              className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-tile"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={tao}
              disabled={chuaDuDe}
              className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
            >
              {busy ? "Đang tạo..." : "Tạo agent"}
            </button>
          </div>
        }
      />

      {loi && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{loi}</p>}

      <AgentFormLayout
        form={form}
        onChange={doi}
        soTaiKhoan={0}
        danhTinh={
          <AgentIdentitySection
            id={id}
            isDefault={false}
            form={form}
            onChange={doi}
            onDoiId={(v) => {
              setId(v);
              setLoi("");
            }}
          />
        }
      />

      {confirmDialog}
    </div>
  );
}
