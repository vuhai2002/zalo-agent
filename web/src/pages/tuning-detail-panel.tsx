import type { TuningDef, TuningGroup, TuningValue } from "../dashboard-api-client";
import { TuningField } from "./tuning-field";

type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Panel phải: nội dung của ĐÚNG MỘT nhóm đang chọn ở nav trái - không đổ hết
 * mọi nhóm ra như bố cục accordion cũ. Có nút "Đặt lại cả nhóm" cạnh tiêu đề vì
 * nút reset từng ô (trong `TuningField`) không đủ khi người dùng muốn trả cả
 * cụm tham số liên quan (vd toàn bộ "Lịch hẹn") về mặc định cùng lúc.
 */
export function TuningDetailPanel({
  group,
  keys,
  defs,
  values,
  onSaveOne,
  onResetGroup,
  extra,
}: {
  group: TuningGroup;
  keys: string[];
  defs: Record<string, TuningDef>;
  values: Record<string, TuningValue>;
  onSaveOne: (key: string, value: number | boolean | string | null) => Promise<SaveResult>;
  onResetGroup: () => void;
  /**
   * Các mục thêm ở cuối panel, không phải tham số trong `TUNING_DEFS` (nhóm
   * "Chung" dùng để chèn đổi mật khẩu + nút đặt lại toàn bộ). Nhận từ ngoài
   * thay vì tự biết nhóm nào có gì - panel này không nên chứa if theo tên nhóm.
   *
   * Là MẢNG chứ không phải một `ReactNode` gộp sẵn: mỗi phần tử phải nằm trong
   * một ô riêng của `divide-y` để có kẻ ngăn và khoảng cách như các tham số.
   * Gộp bằng `<>...</>` thì cả cụm dồn vào một ô, dính liền vào nhau.
   */
  extra?: React.ReactNode[];
}) {
  const coDoiKhoiEnv = keys.some((k) => values[k] && !values[k]!.fromEnv);

  return (
    <div className="min-w-0 flex-1">
      {/* Hơi trong (95%) để thấy được ảnh nền phía sau, kèm blur nhẹ cho chữ
          không bị hoa văn nền làm khó đọc - card đục hoàn toàn thì ảnh nền chỉ
          còn thấy ở mép trang, phí công đặt nền */}
      <div className="rounded-2xl border border-line bg-surface/95 p-6">
        {/* Tiêu đề KHÔNG lặp lại icon của nhóm: icon đã có ngay bên trái ở nav,
            lặp lần nữa cách đó vài chục pixel chỉ thêm nhiễu chứ không thêm tin */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold text-ink">{group.title}</h2>
            <p className="mt-1.5 max-w-3xl text-[13px] leading-[1.7] text-ink-soft">{group.hint}</p>
          </div>
          {coDoiKhoiEnv && (
            <button
              type="button"
              onClick={onResetGroup}
              className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-soft hover:bg-tile"
            >
              Đặt lại nhóm này
            </button>
          )}
        </div>

        {keys.length === 0 && (extra?.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-soft">
            Không có tham số nào khớp từ khóa đang tìm.
          </p>
        ) : (
          // Ngăn cách bằng đường kẻ mảnh chứ không phải khoảng trắng giữa các
          // khối - đây là danh sách thiết lập liền mạch, không phải các thẻ rời
          <div className="divide-y divide-line">
            {keys.map((k) => (
              <div key={k} className="py-4 first:pt-0">
                <TuningField name={k} def={defs[k]!} tuningValue={values[k]!} onSave={onSaveOne} />
              </div>
            ))}
            {/* KHÔNG dùng `first:pt-0` ở đây: các mục này luôn nằm SAU danh
                sách tham số, nên "phần tử đầu" của chúng vẫn cần đệm trên -
                bỏ đệm làm nó dính sát vào đường kẻ phía trên */}
            {extra?.map((muc, i) => (
              <div key={i} className={keys.length === 0 && i === 0 ? "py-5 pt-0" : "py-5"}>
                {muc}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

