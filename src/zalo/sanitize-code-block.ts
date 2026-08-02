/**
 * Tách và trả lại KHỐI CODE cho `sanitize-reply-text.ts`.
 *
 * Tách file vì hai lý do, không phải để cho gọn: file kia đã vượt ngưỡng 200
 * dòng của repo, và phần này là mối quan tâm riêng - nó KHÔNG dọn định dạng mà
 * làm ngược lại, BẢO VỆ một vùng khỏi mọi bước dọn.
 *
 * Module THUẦN: 0 import.
 */

/**
 * Ký tự thay chỗ cho khối code trong lúc xử lý.
 *
 * Dùng ký tự NUL: model không sinh ra nó, và không biểu thức nào trong file này
 * đụng tới. Nhờ vậy nội dung bên trong khối code đi qua các bước markdown mà
 * không bị đụng - trước đây `boKhoiCode` gỡ hàng rào NGAY nên `# Tính tổng`
 * trong đoạn Python bị `boTieuDe` cắt mất dấu thăng và code trả về sai cú pháp.
 */
export const MOC_KHOI = "\u0000";

export type KhoiDaTach = { than: string; khoi: string[] };

/**
 * Tách khối code ra khỏi thân, thay bằng mốc.
 *
 * Hai dạng, tách hẳn hai biểu thức:
 *
 *   - Nhiều dòng: nhãn ngôn ngữ (```` ```js ````) chỉ hợp lệ khi có xuống dòng
 *     NGAY SAU nó. Bắt buộc `\n` là vế chữa lỗi nuốt trắng: bản đầu để
 *     `[^\n`]*\n?` nên với fence cùng dòng, phần đó ăn luôn cả thân, nhóm bắt
 *     rỗng, và ``Chạy ```pnpm dev``` là xong`` ra thành `Chạy  là xong`.
 *   - Cùng dòng: giữ nguyên nội dung, chỉ bỏ hàng rào.
 *
 * Bắt buộc `\n` cũng khử luôn nhánh bậc hai: `[^\n`]*` không vượt được dòng đầu
 * nên không còn đường backtrack chồng lên `[\s\S]*?`.
 *
 * Nhãn ngôn ngữ KHÔNG có `[ \t]*` dẫn đầu, và hai lượng từ còn lại đều kẹp
 * trần. Bản trước viết `[ \t]*[A-Za-z0-9+#._-]*[ \t]*` - HAI lượng từ trên
 * cùng lớp `[ \t]` ngăn nhau bởi một lớp có thể rỗng, đúng thứ mà luật số 2 ở
 * đầu file này cấm. Đo thật `"```" + " ".repeat(n) + "x"`: 20.000 dấu cách mất
 * 209ms, 80.000 mất 3,3 giây, 200.000 mất **20,5 giây** - đủ treo cả tiến
 * trình. Sau khi vá: 200.000 còn 1ms. Nhãn thật (```` ```js ````) không bao giờ
 * có khoảng trắng dẫn nên bỏ vế đó không mất gì.
 */
export function tachKhoiCode(text: string, daSua: string[]): KhoiDaTach {
  const khoi: string[] = [];
  const giu = (than: string): string => {
    khoi.push(than);
    return `${MOC_KHOI}${khoi.length - 1}${MOC_KHOI}`;
  };

  let than = text.replace(
    /```[A-Za-z0-9+#._-]{0,32}[ \t]{0,32}\r?\n([\s\S]*?)```/g,
    (_, ben: string) => giu(ben.replace(/\s+$/, "")),
  );
  than = than.replace(/```([^`\n]+)```/g, (_, ben: string) => giu(ben));

  if (khoi.length > 0) daSua.push("khối code");
  return { than, khoi };
}

/** Trả nội dung khối code về đúng chỗ, sau khi mọi bước markdown đã chạy xong */
export function traKhoiCodeVe(text: string, khoi: string[]): string {
  if (khoi.length === 0) return text;
  return text.replace(new RegExp(`${MOC_KHOI}(\\d+)${MOC_KHOI}`, "g"), (nguyenVan, i: string) => khoi[Number(i)] ?? nguyenVan);
}
