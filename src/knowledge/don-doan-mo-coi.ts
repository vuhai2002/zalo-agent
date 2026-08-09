import { db } from "../conversation/database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";

/**
 * Dọn đoạn/hàng FTS MỒ CÔI (source_id không còn tồn tại trong `kb_sources`) -
 * vá đúng cửa sổ race I4: worker đang `await` trích xuất một nguồn thì route
 * DELETE xoá nguồn đó xen vào; `xoaNguon()` chạy TRƯỚC khi worker kịp `luuDoan`
 * nên không dọn được gì (nó xoá đúng lúc chưa có đoạn nào để xoá), còn worker
 * thì có kiểm "nguồn còn tồn tại" trước khi ghi (xem `kb-ingest-worker.ts`) NÊN
 * cửa sổ này bình thường không sinh mồ côi MỚI nữa - hàm này là lưới an toàn
 * cho những đường CŨ hơn không có kiểm đó (bản trước phase này), và cho các ca
 * chưa lường hết.
 *
 * Gọi MỘT LẦN lúc boot (`kb-ingest-worker.ts#batDauWorker`), không chạy định
 * kỳ: mồ côi chỉ sinh ra ở đúng cửa sổ race hiếm, không tích luỹ liên tục giữa
 * hai lần khởi động.
 */
export function donDoanMoCoi(): { soDoan: number; soHangFts: number } {
  return trongGiaoDich(db, () => {
    // Đếm TRƯỚC khi xoá: câu DELETE của kb_chunks_fts cần subquery dựa vào
    // kb_chunks CÒN NGUYÊN để tra rowid mồ côi, và rowid của FTS luôn khớp 1-1
    // với kb_chunks.id lúc chèn (xem kb-schema.ts) - nên số hàng mồ côi ở CẢ
    // HAI bảng LUÔN BẰNG NHAU, không cần đếm riêng bảng FTS.
    const { n: soDoan } = db
      .prepare(`SELECT COUNT(*) AS n FROM kb_chunks WHERE source_id NOT IN (SELECT id FROM kb_sources)`)
      .get() as { n: number };
    if (soDoan === 0) return { soDoan: 0, soHangFts: 0 };

    db.prepare(
      `DELETE FROM kb_chunks_fts WHERE rowid IN (SELECT id FROM kb_chunks WHERE source_id NOT IN (SELECT id FROM kb_sources))`,
    ).run();
    db.prepare(`DELETE FROM kb_chunks WHERE source_id NOT IN (SELECT id FROM kb_sources)`).run();

    return { soDoan, soHangFts: soDoan };
  });
}
