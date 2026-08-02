import { useEffect, useMemo, useState } from "react";
import type { TuningDef, TuningGroup, TuningValue } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { IconGear, IconSearch } from "../shared/dashboard-icons";
import { ChangePasswordSection } from "./change-password-section";
import { ResetAllSettingsSection } from "./reset-all-settings-section";
import { TuningDetailPanel } from "./tuning-detail-panel";
import { TuningNav } from "./tuning-nav";

type SaveResult = { ok: true } | { ok: false; error: string };

/** Nhóm chứa thêm mật khẩu + nút đặt lại tất cả - khớp `id` ở tuning-definitions */
const NHOM_CHUNG = "chung";

/**
 * Trang Cấu hình: những tham số trước đây chỉ sửa được bằng cách mở `.env` rồi
 * khởi động lại bot.
 *
 * Bố cục CHỌN-MỘT: nav trái liệt kê từng nhóm (icon + mô tả + số ô), bấm vào
 * nhóm nào thì panel phải CHỈ hiện đúng nhóm đó - không đổ hết mọi nhóm ra một
 * mạch dài như bản accordion cũ. Mặc định mở nhóm đầu tiên ("Chung").
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
  const [dangChon, setDangChon] = useState("");

  useEffect(() => {
    void nap();
  }, []);

  async function nap() {
    try {
      const r = await api.tuning.get();
      setGroups(r.groups);
      setDefs(r.defs);
      setValues(Object.fromEntries(r.values.map((v) => [v.key, v])));
      // Mặc định mở nhóm ĐẦU TIÊN server trả về ("Chung") - chỉ đặt lần nạp
      // đầu, không ghi đè lựa chọn người dùng ở các lần load lại sau reset
      setDangChon((truoc) => truoc || r.groups[0]?.id || "");
    } catch (e) {
      setLoi((e as Error).message);
    }
  }

  const oCuaNhom = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [key, def] of Object.entries(defs)) {
      const arr = map.get(def.group) ?? [];
      arr.push(key);
      map.set(def.group, arr);
    }
    return map;
  }, [defs]);

  /**
   * Tìm theo NHÃN tiếng Việt lẫn TÊN biến, bỏ dấu để gõ không dấu vẫn khớp.
   * Khớp ô nào thì tự chuyển nav sang ĐÚNG nhóm chứa ô đó - người dùng gõ "trần
   * tin" không cần biết trước nó nằm ở nhóm "Lịch hẹn".
   */
  const ketQuaTim = useMemo(() => {
    const q = boDau(tim.trim());
    if (!q) return null;
    return Object.keys(defs).filter(
      (k) => boDau(defs[k]!.label).includes(q) || boDau(k).includes(q) || boDau(defs[k]!.hint).includes(q),
    );
  }, [tim, defs]);

  useEffect(() => {
    if (ketQuaTim && ketQuaTim.length > 0) {
      const nhomDauTien = defs[ketQuaTim[0]!]?.group;
      if (nhomDauTien) setDangChon(nhomDauTien);
    }
  }, [ketQuaTim, defs]);

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

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zalo-50 text-zalo-500">
            <IconGear size={22} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Cấu hình</h1>
            <p className="mt-0.5 text-[14px] text-ink-soft">
              Thiết lập và tùy chỉnh bot để phù hợp với nhu cầu sử dụng của bạn.
            </p>
          </div>
        </div>
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
      </div>

      {loi && (
        <div className="mb-4 whitespace-pre-line rounded-xl border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-[13px] leading-[1.6] text-red-700 dark:text-red-300">
          {loi}
        </div>
      )}

      <div className="flex flex-col gap-5 pb-10 lg:flex-row">
        <TuningNav groups={groups} dangChon={dangChon} onChon={setDangChon} />

        {nhomDangXem && (
          <TuningDetailPanel
            group={nhomDangXem}
            keys={(oCuaNhom.get(nhomDangXem.id) ?? []).filter((k) => !ketQuaTim || ketQuaTim.includes(k))}
            defs={defs}
            values={values}
            onSaveOne={luuMot}
            onResetGroup={() => void resetCaNhom(nhomDangXem.id)}
            extra={
              // Mật khẩu + đặt lại toàn bộ chỉ thuộc nhóm "Chung"; đang lọc tìm
              // kiếm thì ẩn đi - chúng không phải tham số nên không khớp từ khóa
              // nào, để lại chỉ làm nhiễu kết quả
              nhomDangXem.id === NHOM_CHUNG && !ketQuaTim
                ? [
                    <ChangePasswordSection key="mat-khau" />,
                    <ResetAllSettingsSection
                      key="dat-lai"
                      soODaDoi={oDaDoiToanTrang.length}
                      onResetAll={resetToanBo}
                    />,
                  ]
                : undefined
            }
          />
        )}
      </div>
    </>
  );
}

/** Bỏ dấu tiếng Việt để tìm kiếm gõ không dấu vẫn khớp */
function boDau(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}
