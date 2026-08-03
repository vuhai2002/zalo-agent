import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { TuningDef, TuningGroup, TuningValue } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconGear, IconSearch } from "../shared/dashboard-icons";
import { ChangePasswordSection } from "./change-password-section";
import { ProvidersSection } from "./providers-section";
import { ResetAllSettingsSection } from "./reset-all-settings-section";
import { TuningDetailPanel } from "./tuning-detail-panel";
import { TuningNav } from "./tuning-nav";
import { useTimKiemTuning } from "./use-tuning-search";

type SaveResult = { ok: true } | { ok: false; error: string };

/** Nhóm chứa thêm mật khẩu + nút đặt lại tất cả - khớp `id` ở tuning-definitions */
const NHOM_CHUNG = "general";
/** Nhóm KHÔNG có tham số nào, nội dung là form nhà cung cấp LLM */
const NHOM_PROVIDERS = "providers";

/**
 * Trang Cấu hình: những tham số trước đây chỉ sửa được bằng cách mở `.env` rồi
 * khởi động lại bot.
 *
 * Bố cục CHỌN-MỘT: nav trái liệt kê từng nhóm (icon + mô tả + số ô), bấm vào
 * nhóm nào thì panel phải CHỈ hiện đúng nhóm đó - không đổ hết mọi nhóm ra một
 * mạch dài như bản accordion cũ. Mặc định mở nhóm đầu tiên ("Nhà cung cấp LLM"
 * - thứ phải cấu hình trước tiên, thiếu nó bot không trả lời được tin nào).
 *
 * TỰ LƯU từng ô, không có nút "Lưu" tổng: server nhận PATCH 1 tham số/lần
 * (`api.tuning.save({[key]: value})`), khác bản trước gửi cả cụm đã đổi. Ràng
 * buộc CHÉO giữa tham số (`validateTuning` ở server) vẫn được kiểm mỗi lần lưu
 * - lưu từng ô không tắt được luật đó, chỉ đổi cách gọi API.
 */
export function TuningPage() {
  const [groups, setGroups] = useState<TuningGroup[]>([]);
  const [defs, setDefs] = useState<Record<string, TuningDef>>({});
  const [values, setValues] = useState<Record<string, TuningValue>>({});
  const [loi, setLoi] = useState("");
  const [tim, setTim] = useState("");
  // Nhóm đang xem nằm trên URL (`/tuning/:nhom`) chứ không phải state trong
  // component: banner "Chưa cấu hình LLM" ở Overview phải link được THẲNG vào
  // form nhà cung cấp, đúng lúc người dùng mới cài đang bối rối nhất. Tiện thể
  // mọi nhóm khác cũng bookmark và chia sẻ link được.
  const { nhom } = useParams<{ nhom?: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    void nap();
  }, []);

  async function nap() {
    try {
      const r = await api.tuning.get();
      setGroups(r.groups);
      setDefs(r.defs);
      setValues(Object.fromEntries(r.values.map((v) => [v.key, v])));
    } catch (e) {
      setLoi((e as Error).message);
    }
  }

  // URL trống hoặc trỏ tới nhóm không tồn tại (gõ tay, link cũ) thì đưa về nhóm
  // đầu tiên. `replace` để nút Back không kẹt lại ở địa chỉ hỏng.
  const nhomHopLe = groups.some((g) => g.id === nhom);
  useEffect(() => {
    if (groups.length && !nhomHopLe) navigate(`/tuning/${groups[0]!.id}`, { replace: true });
  }, [groups, nhomHopLe, navigate]);

  const dangChon = nhomHopLe ? nhom! : (groups[0]?.id ?? "");

  const oCuaNhom = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [key, def] of Object.entries(defs)) {
      const arr = map.get(def.group) ?? [];
      arr.push(key);
      map.set(def.group, arr);
    }
    return map;
  }, [defs]);

  const ketQuaTim = useTimKiemTuning(defs, tim);

  async function luuMot(key: string, value: number | boolean | string | null): Promise<SaveResult> {
    try {
      const r = await api.tuning.save({ [key]: value });
      setValues((truoc) => ({ ...truoc, ...Object.fromEntries(r.values.map((v) => [v.key, v])) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function resetCaNhom(groupId: string) {
    const keys = oCuaNhom.get(groupId) ?? [];
    const canReset = keys.filter((k) => !values[k]?.fromEnv);
    for (const k of canReset) await luuMot(k, null);
  }

  /** Tham số đang KHÁC .env trên TOÀN trang - số hiện ở nút đặt lại tất cả */
  const oDaDoiToanTrang = Object.keys(defs).filter((k) => values[k] && !values[k]!.fromEnv);

  /**
   * Đặt lại mọi nhóm về .env trong MỘT request: gửi từng key sẽ bắn ~30 lượt
   * gọi API liên tiếp, và hỏng giữa chừng thì để lại trạng thái nửa vời.
   */
  async function resetToanBo() {
    if (oDaDoiToanTrang.length === 0) return;
    const rong = Object.fromEntries(oDaDoiToanTrang.map((k) => [k, null]));
    try {
      const r = await api.tuning.save(rong);
      setValues(Object.fromEntries(r.values.map((v) => [v.key, v])));
      setLoi("");
    } catch (e) {
      setLoi((e as Error).message);
    }
  }

  const nhomDangXem = groups.find((g) => g.id === dangChon);

  /**
   * Khối không-phải-tham-số của từng nhóm. Bảng tra thay cho chuỗi if lồng:
   * thêm nhóm mới chỉ là thêm một dòng, không phải sửa biểu thức điều kiện.
   */
  const KHOI_THEM: Record<string, () => React.ReactNode[]> = {
    [NHOM_PROVIDERS]: () => [<ProvidersSection key="nha-cung-cap" />],
    [NHOM_CHUNG]: () => [
      <ChangePasswordSection key="mat-khau" />,
      <ResetAllSettingsSection
        key="dat-lai"
        soODaDoi={oDaDoiToanTrang.length}
        onResetAll={resetToanBo}
      />,
    ],
  };

  return (
    <>
      {/* Dùng PageHeader chung như mọi trang khác - trước đây trang này tự dựng
          header riêng, nên sửa kiểu dáng ở một nơi là hai bên lệch nhau ngay */}
      <PageHeader
        icon={IconGear}
        title="Cấu hình"
        subtitle="Thiết lập và tùy chỉnh bot để phù hợp với nhu cầu sử dụng của bạn."
        aside={
          <div className="relative w-full max-w-xs">
            <IconSearch
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft/60"
            />
            <input
              type="search"
              className="gc-input w-full pr-10"
              placeholder="Tìm kiếm cấu hình..."
              value={tim}
              onChange={(e) => setTim(e.target.value)}
            />
          </div>
        }
      />

      {loi && (
        <div className="mb-4 whitespace-pre-line rounded-xl border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-[13px] leading-[1.6] text-red-700 dark:text-red-300">
          {loi}
        </div>
      )}

      <div className="flex flex-col gap-5 pb-10 lg:flex-row">
        <TuningNav groups={groups} dangChon={dangChon} onChon={(id) => navigate(`/tuning/${id}`)} />

        {nhomDangXem && (
          <TuningDetailPanel
            group={nhomDangXem}
            keys={(oCuaNhom.get(nhomDangXem.id) ?? []).filter((k) => !ketQuaTim || ketQuaTim.includes(k))}
            defs={defs}
            values={values}
            onSaveOne={luuMot}
            onResetGroup={() => void resetCaNhom(nhomDangXem.id)}
            extra={
              // Các khối KHÔNG phải tham số, gắn thêm theo nhóm. Đang lọc tìm
              // kiếm thì ẩn hết - chúng không khớp từ khóa nào nên để lại chỉ
              // làm nhiễu kết quả.
              ketQuaTim ? undefined : (KHOI_THEM[nhomDangXem.id]?.() ?? undefined)
            }
          />
        )}
      </div>
    </>
  );
}
