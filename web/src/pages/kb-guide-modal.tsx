import { useChotNen } from "../shared/backdrop-close-guard";

/**
 * Hướng dẫn dùng Kho tri thức, mở từ nút cạnh "Thêm nguồn".
 *
 * Nội dung ở đây KHÔNG phải trang trí: ba điều dưới đây đều đã làm người dùng
 * thật lạc đường, nên mỗi mục là một câu trả lời cho một câu hỏi có thật.
 * - Nạp xong KHÔNG có nghĩa là bot dùng được: phải gán nguồn cho agent.
 * - Bot chỉ tra kho khi câu hỏi liên quan tới tài liệu nội bộ, không tra mọi lúc.
 * - docx và PDF cho chất lượng KHÁC nhau (PDF không có đường dẫn tiêu đề).
 */

function Muc({ so, tieuDe, children }: { so: string; tieuDe: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zalo-50 text-[12px] font-semibold text-zalo-700 dark:bg-zalo-950/40 dark:text-zalo-400">
        {so}
      </div>
      <div className="min-w-0 space-y-1">
        <div className="text-[14px] font-medium text-ink">{tieuDe}</div>
        <div className="space-y-1 text-[13px] leading-[1.6] text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

export function KbGuideModal({ onClose }: { onClose: () => void }) {
  const nen = useChotNen(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]" {...nen}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="font-semibold text-ink">Dùng Kho tri thức thế nào</div>
          <button
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile"
          >
            Đóng
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Muc so="1" tieuDe="Nạp tài liệu">
            <p>
              Bấm <span className="font-medium text-ink">Thêm nguồn</span> để tải file lên hoặc gõ tay nội dung. Kéo
              thả file thẳng vào bảng cũng được.
            </p>
            <p>
              Nhận file <span className="font-medium text-ink">.docx, .xlsx, .pdf, .txt, .md</span>. Bot đọc CHỮ trong
              file - PDF chụp ảnh hoặc scan không có lớp chữ thì đọc ra rỗng.
            </p>
            <p>
              Chất lượng tốt nhất là <span className="font-medium text-ink">.docx</span>: bot giữ được cấu trúc tiêu đề
              nên mỗi đoạn trích ra mang theo đường dẫn kiểu "Chính sách &gt; Đổi trả &gt; Điều kiện", trả lời sát ngữ
              cảnh hơn. PDF không có cấu trúc đó.
            </p>
          </Muc>

          <Muc so="2" tieuDe="Gán nguồn cho agent - BƯỚC BẮT BUỘC">
            <p>
              Nạp xong <span className="font-medium text-ink">chưa đủ</span>. Trạng thái "Sẵn sàng" chỉ có nghĩa là đã
              cắt đoạn xong, không có nghĩa là bot đọc được.
            </p>
            <p>
              Mặc định <span className="font-medium text-ink">không agent nào</span> đọc được nguồn mới - đây là chủ
              đích, để agent này không vô tình đọc tài liệu nạp cho agent khác.
            </p>
            <p>
              Bấm <span className="font-medium text-ink">Gán</span> ở cột "Agent đang dùng" và chọn agent. Nguồn chưa
              gán ai sẽ hiện cảnh báo ở cột đó. Gán được cả ở trang Agents khi sửa từng agent.
            </p>
          </Muc>

          <Muc so="3" tieuDe="Khi nào bot tra kho">
            <p>
              Bot tự quyết định, không cần ai ra lệnh. Nó tra khi câu hỏi thuộc về tài liệu nội bộ:{" "}
              <span className="text-ink">chính sách, bảng giá, quy trình, hướng dẫn, thông tin công ty</span>. Câu trả
              lời có dẫn tên nguồn để đối chiếu.
            </p>
            <p>
              Ví dụ tra kho: "Bảng giá gói doanh nghiệp bao nhiêu?", "Chính sách đổi trả thế nào?", "Công ty có những
              dịch vụ gì?", "Địa chỉ và hotline?".
            </p>
            <p>
              Ví dụ KHÔNG tra kho: hỏi tin tức, tỷ giá, thời tiết (đi tra web), tán gẫu, nhờ soạn văn bản hay vẽ ảnh.
            </p>
            <p>
              Nếu bot trả lời chung chung thay vì lấy từ tài liệu, kiểm hai chỗ trước: nguồn đã gán cho ĐÚNG agent đang
              chat chưa, và bấm <span className="font-medium text-ink">Xem đoạn</span> để soi bot thật sự đọc ra gì từ
              file đó.
            </p>
          </Muc>

          <Muc so="4" tieuDe="Kiểm tra khi kết quả không như ý">
            <p>
              <span className="font-medium text-ink">Xem đoạn</span> hiện đúng nội dung bot đọc được. Bảng Excel lộn
              cột, PDF ra chữ rác, file thiếu phần cuối - nhìn ở đây là thấy ngay.
            </p>
            <p>
              Sửa tài liệu rồi thì xóa nguồn cũ và nạp lại. Lưu ý xóa nguồn sẽ gỡ nó khỏi mọi agent đang dùng, gán lại
              sau khi nạp bản mới.
            </p>
          </Muc>
        </div>
      </div>
    </div>
  );
}
