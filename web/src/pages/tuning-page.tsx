import { useEffect, useState } from "react";
import type { TuningDef, TuningGroup, TuningValue } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { TuningField } from "./tuning-field";

/**
 * Trang Cấu hình: những tham số trước đây chỉ sửa được bằng cách mở `.env` rồi
 * khởi động lại bot.
 *
 * Danh mục, nhãn, gợi ý và khoảng cho phép đều lấy từ backend, nên thêm tham số
 * mới chỉ cần sửa `tuning-definitions.ts` - file này không phải đụng tới.
 *
 * Lưu CẢ TRANG một lần chứ không lưu từng ô: có ràng buộc giữa các tham số (trần
 * thời gian lượt phải lớn hơn trần vẽ ảnh), lưu lẻ từng ô sẽ chặn oan khi người
 * dùng đang sửa dở cả cặp.
 */
export function TuningPage() {
  const [groups, setGroups] = useState<TuningGroup[]>([]);
  const [defs, setDefs] = useState<Record<string, TuningDef>>({});
  const [goc, setGoc] = useState<Record<string, TuningValue>>({});
  const [nhap, setNhap] = useState<Record<string, number | boolean | string>>({});
  const [loi, setLoi] = useState("");
  const [xong, setXong] = useState("");
  const [dangLuu, setDangLuu] = useState(false);

  useEffect(() => {
    void nap();
  }, []);

  async function nap() {
    try {
      const r = await api.tuning.get();
      setGroups(r.groups);
      setDefs(r.defs);
      setGoc(Object.fromEntries(r.values.map((v) => [v.key, v])));
      setNhap(Object.fromEntries(r.values.map((v) => [v.key, v.value])));
    } catch (e) {
      setLoi((e as Error).message);
    }
  }

  const daDoi = Object.keys(nhap).filter((k) => nhap[k] !== goc[k]?.value);

  async function luu() {
    setDangLuu(true);
    setLoi("");
    setXong("");
    try {
      const r = await api.tuning.save(Object.fromEntries(daDoi.map((k) => [k, nhap[k]!])));
      setGoc(Object.fromEntries(r.values.map((v) => [v.key, v])));
      setNhap(Object.fromEntries(r.values.map((v) => [v.key, v.value])));
      setXong(`Đã lưu ${daDoi.length} thay đổi, có hiệu lực ngay từ lượt tiếp theo.`);
    } catch (e) {
      setLoi((e as Error).message);
    } finally {
      setDangLuu(false);
    }
  }

  /** Trả ô về giá trị trong .env (xóa phần đè trong cơ sở dữ liệu) */
  async function veMacDinh(key: string) {
    setDangLuu(true);
    setLoi("");
    try {
      const r = await api.tuning.save({ [key]: null });
      setGoc(Object.fromEntries(r.values.map((v) => [v.key, v])));
      setNhap(Object.fromEntries(r.values.map((v) => [v.key, v.value])));
      setXong("Đã trả về giá trị trong .env.");
    } catch (e) {
      setLoi((e as Error).message);
    } finally {
      setDangLuu(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Cấu hình"
        subtitle="Chỉnh cách bot làm việc mà không cần mở file .env hay khởi động lại. Ô chưa chỉnh thì đang lấy giá trị từ .env."
      />

      {loi && (
        <div className="mb-4 whitespace-pre-line rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[13px] leading-[1.6] text-red-700">
          {loi}
        </div>
      )}
      {xong && (
        <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">
          {xong}
        </div>
      )}

      <div className="space-y-4 pb-24">
        {groups.map((g) => {
          const keys = Object.keys(defs).filter((k) => defs[k]!.group === g.id);
          if (keys.length === 0) return null;
          return (
            <section key={g.id} className="rounded-xl border border-line bg-white px-5 py-4">
              <div className="mb-1 text-[15px] font-semibold text-ink">{g.title}</div>
              <div className="mb-4 text-[13px] leading-[1.6] text-ink-soft">{g.hint}</div>
              <div className="space-y-4">
                {keys.map((k) => (
                  <TuningField
                    key={k}
                    name={k}
                    def={defs[k]!}
                    value={nhap[k]!}
                    fromEnv={goc[k]?.fromEnv ?? true}
                    daDoi={nhap[k] !== goc[k]?.value}
                    onChange={(v) => setNhap({ ...nhap, [k]: v })}
                    onReset={() => void veMacDinh(k)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {daDoi.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 px-5 py-3 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <span className="text-[13px] text-ink-soft">Đang sửa {daDoi.length} mục</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNhap(Object.fromEntries(Object.entries(goc).map(([k, v]) => [k, v.value])))}
                className="rounded-lg border border-line px-4 py-2 text-[13px] text-ink-soft hover:bg-tile"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void luu()}
                disabled={dangLuu}
                className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {dangLuu ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
