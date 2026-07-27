/**
 * Bộ đếm hạn mức theo cửa sổ TRƯỢT 1 giờ, đếm riêng từng key (thường là
 * `accountId:threadId`).
 *
 * Bot đọc tin người lạ nên mọi tool tốn kém đều cần trần: tạo file tốn CPU, vẽ
 * ảnh tốn tiền thật. Tách ra dùng chung vì phần khó không phải chuyện đếm mà là
 * chuyện DỌN: giữ entry cho mọi thread từng nhắn thì bộ nhớ phình vô hạn khi
 * chạy dài ngày (hồi quy rò rỉ Map ở V2.4). Chép logic này sang chỗ thứ hai là
 * chép cả cái bẫy đó, và bản sửa cho chỗ này sẽ không bao giờ tới chỗ kia.
 */

/** Cửa sổ tính hạn mức - chính sách chống spam, không có "con số đúng" */
const WINDOW_MS = 60 * 60 * 1000;

export type RateCheck = { ok: true } | { ok: false; reason: string };

export type HourlyRateLimitOptions = {
  /** Hàm chứ không phải số: trần đọc từ env lúc GỌI nên đổi env là ăn ngay */
  limit: () => number;
  buildReason: (info: { used: number; limit: number; waitMinutes: number }) => string;
};

export type HourlyRateLimit = {
  /** Còn suất thì GHI NHẬN luôn lần này rồi trả ok */
  check: (key: string, now?: number) => RateCheck;
  /** Chỉ dùng cho test - xóa toàn bộ trạng thái đếm */
  reset: () => void;
};

export function createHourlyRateLimit({ limit, buildReason }: HourlyRateLimitOptions): HourlyRateLimit {
  /** key -> mốc thời gian các lần dùng còn trong cửa sổ */
  const recentByKey = new Map<string, number[]>();

  function pruneStale(cutoff: number): void {
    for (const [key, times] of recentByKey) {
      const alive = times.filter((at) => at > cutoff);
      if (alive.length === 0) recentByKey.delete(key);
      else if (alive.length !== times.length) recentByKey.set(key, alive);
    }
  }

  return {
    check(key, now = Date.now()) {
      const cutoff = now - WINDOW_MS;
      const max = limit();
      const recent = (recentByKey.get(key) ?? []).filter((at) => at > cutoff);

      if (recent.length >= max) {
        // Dọn luôn các key khác đã nguội - tiện thể tránh phình Map
        pruneStale(cutoff);
        recentByKey.set(key, recent);
        const waitMinutes = Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 60_000));
        return { ok: false, reason: buildReason({ used: recent.length, limit: max, waitMinutes }) };
      }

      recent.push(now);
      recentByKey.set(key, recent);
      pruneStale(cutoff);
      return { ok: true };
    },

    reset() {
      recentByKey.clear();
    },
  };
}
