import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Bối cảnh của LƯỢT đang chạy, tự bám vào mọi dòng log sinh ra bên trong nó.
 *
 * Vì sao cần: gắn `turnId` bằng child logger chỉ phủ được module nào cầm cái
 * logger đó. Đo trên lượt thật (turn 65): 11 dòng có turnId, 3 dòng KHÔNG -
 * chúng đến từ `web-fetch-tool` vốn tự tạo logger riêng. Còn 5 module như vậy
 * (`web-fetch-tool`, `create-image-tool`, `create-document-tools`,
 * `web-search-providers`, `jina-reader-fallback`), và mỗi tool mới thêm sau này
 * lại là một chỗ nữa dễ quên.
 *
 * Cách còn lại là luồn `turnId` qua chữ ký hàm xuống từng module - nhưng
 * `searchWeb(query, opts)` hay `fetchViaJina(url)` không có việc gì với "lượt",
 * thêm tham số vào đó là bôi bẩn API để phục vụ chuyện log.
 *
 * AsyncLocalStorage giữ đúng ngữ cảnh qua await/Promise, nên `logger.ts` chỉ cần
 * đọc nó trong `mixin` là mọi dòng tự có - không module nào phải biết gì.
 */

export type TurnLogContext = {
  accountId: string;
  threadId: string;
  turnId: number;
};

const storage = new AsyncLocalStorage<TurnLogContext>();

/** Chạy `fn` trong ngữ cảnh lượt - mọi log bên trong (kể cả sau await) tự mang các field này */
export function runInTurnLogContext<T>(context: TurnLogContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Ngữ cảnh hiện tại, hoặc undefined khi chạy ngoài lượt (khởi động, dashboard,
 * dọn media định kỳ). Trả undefined chứ không phải object rỗng để `mixin` khỏi
 * ghép thêm gì vào những dòng đó.
 */
export function currentTurnLogContext(): TurnLogContext | undefined {
  return storage.getStore();
}
