import { useState } from "react";
import type { KbSourceListItem } from "../dashboard-api-client";
import { ApiError } from "../dashboard-api-client";
import { Badge, formatTime, O_GHIM_PHAI } from "../shared/ui-bits";
import { IconEye, IconUndo, IconUsers, IconWarning } from "../shared/dashboard-icons";

/** "1,2 KB" / "3,4 MB" từ số byte - 0 byte (nguồn gõ tay) hiện "-" */
function formatBytes(soByte: number): string {
  if (soByte <= 0) return "-";
  if (soByte < 1024) return `${soByte} B`;
  if (soByte < 1024 * 1024) return `${(soByte / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} KB`;
  return `${(soByte / (1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
}

const NHAN_TRANG_THAI: Record<KbSourceListItem["trangThai"], { tone: "blue" | "gray" | "green" | "red" | "amber"; text: string }> = {
  cho_xu_ly: { tone: "gray", text: "Chờ xử lý" },
  dang_xu_ly: { tone: "amber", text: "Đang xử lý" },
  san_sang: { tone: "green", text: "Sẵn sàng" },
  hong: { tone: "red", text: "Hỏng" },
};

export function KbSourceRow({
  source,
  onReindex,
  onDelete,
  onViewChunks,
  onAssignAgents,
}: {
  source: KbSourceListItem;
  onReindex: () => Promise<void>;
  onDelete: () => void;
  /** I21: mở modal xem đoạn đã cắt - cách duy nhất người vận hành tự phát hiện lỗi đọc file */
  onViewChunks: () => void;
  /** Mở modal gán nguồn này cho agent - đường thoát khỏi ngõ cụt "nạp xong mà bot không thấy" */
  onAssignAgents: () => void;
}) {
  const [dangXuLyLai, setDangXuLyLai] = useState(false);
  const [loiXuLyLai, setLoiXuLyLai] = useState("");
  const trangThai = NHAN_TRANG_THAI[source.trangThai];

  async function xuLyLai() {
    setDangXuLyLai(true);
    setLoiXuLyLai("");
    try {
      await onReindex();
    } catch (err) {
      setLoiXuLyLai(err instanceof ApiError ? err.message : "Đặt lại xử lý thất bại");
    } finally {
      setDangXuLyLai(false);
    }
  }

  return (
    <tr className="border-b border-line/60 last:border-0 hover:bg-tile/40">
      <td className="max-w-xs px-4 py-3 text-ink">
        <div className="truncate font-medium">{source.ten}</div>
        {source.trangThai === "hong" && source.loi && (
          <div className="mt-0.5 truncate text-[12px] text-red-600 dark:text-red-400" title={source.loi}>
            {source.loi}
          </div>
        )}
        {/* Số lần đã thử cũng có nghĩa với nguồn đang KẸT ở "Chờ xử lý" (đã tiêu
            hết lượt thử nên không nguồn nào giành nữa) - không riêng gì nguồn Hỏng */}
        {(source.trangThai === "hong" || (source.trangThai === "cho_xu_ly" && source.soLanThu > 0)) && (
          <div className="mt-0.5 text-[11px] text-ink-soft">Đã thử {source.soLanThu} lần</div>
        )}
        {loiXuLyLai && <div className="mt-0.5 text-[12px] text-red-600 dark:text-red-400">{loiXuLyLai}</div>}
      </td>
      {/* "Loại" và "Định dạng" GỘP làm một: nguồn `file` luôn có định dạng, nguồn
          `text` luôn không - hai cột rời nhau chỉ tốn bề ngang mà không nói thêm
          gì. Bề ngang đó có giá thật: bảng rộng quá khung là cột thao tác
          ("Xem đoạn", "Xóa") bị đẩy ra ngoài, phải cuộn ngang mới thấy - đúng
          lý do người dùng báo "không thấy chỗ xem nội dung đã nạp". */}
      <td className="px-4 py-3 text-ink-soft">{source.loai === "file" ? source.dinhDang || "file" : "Gõ tay"}</td>
      <td className="px-4 py-3">
        <Badge tone={trangThai.tone}>{trangThai.text}</Badge>
      </td>
      {/* Cột này là thứ DUY NHẤT phân biệt "đã cắt đoạn xong" với "bot dùng
          được": `kb_search` chỉ vào toolset của agent khi agent đó có ít nhất
          một nguồn. Nguồn 0 agent mà chỉ hiện "Sẵn sàng" là mọi tín hiệu trên
          màn hình đều nói xong rồi trong khi bot không hề thấy tài liệu. */}
      <td className="px-4 py-3">
        <button
          onClick={onAssignAgents}
          title={source.soAgent === 0 ? "Chưa agent nào đọc được - bấm để gán" : "Đổi agent đọc được nguồn này"}
          className={`flex cursor-pointer items-center gap-1.5 text-[13px] hover:underline ${
            source.soAgent === 0 ? "text-amber-700 dark:text-amber-400" : "text-ink-soft hover:text-ink"
          }`}
        >
          {source.soAgent === 0 ? (
            <>
              <IconWarning size={14} />
              Chưa gán
            </>
          ) : (
            <>
              <IconUsers size={14} />
              {source.soAgent} agent
            </>
          )}
        </button>
      </td>
      <td className="px-4 py-3 text-ink-soft">{source.soDoan}</td>
      <td className="px-4 py-3 text-ink-soft">{formatBytes(source.soByte)}</td>
      <td className="px-4 py-3 text-ink-soft">{formatTime(source.createdAt)}</td>
      <td className={`px-4 py-3 ${O_GHIM_PHAI}`}>
        <div className="flex items-center justify-end gap-3">
          {/* Hiện cho CẢ "cho_xu_ly" lẫn "hong": nguồn có thể KẸT ở "Chờ xử lý"
              mà không có đường thoát nào - xảy ra khi hạ "Số lần thử lại một
              nguồn" trên trang Cấu hình lúc đang chạy, nguồn đã tiêu quá số lượt
              mới thì `giaNguonChoXuLy` không giành nữa và nó nằm đó vĩnh viễn.
              Route /reindex cấp lại lượt thử (soLanThu = 0) nên bấm là thoát;
              nó chỉ từ chối 409 với "dang_xu_ly", không phải trạng thái này. */}
          {(source.trangThai === "hong" || source.trangThai === "cho_xu_ly") && (
            <button
              onClick={() => void xuLyLai()}
              disabled={dangXuLyLai}
              title="Xử lý lại"
              className="flex cursor-pointer items-center gap-1 text-[13px] text-zalo-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-zalo-400"
            >
              <IconUndo size={14} />
              {dangXuLyLai ? "Đang xử lý..." : "Xử lý lại"}
            </button>
          )}
          <button
            onClick={onViewChunks}
            title="Xem đoạn đã cắt"
            className="flex cursor-pointer items-center gap-1 text-[13px] text-ink-soft hover:underline hover:text-ink"
          >
            <IconEye size={14} />
            Xem đoạn
          </button>
          <button
            onClick={onDelete}
            className="cursor-pointer text-[13px] text-red-600 hover:underline dark:text-red-400"
          >
            Xóa
          </button>
        </div>
      </td>
    </tr>
  );
}
