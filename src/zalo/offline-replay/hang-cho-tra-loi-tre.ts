import { createLogger } from "../../shared/logger.js";
import type { ParsedMessage } from "../zalo-message-parser.js";

/**
 * Hàng chờ trả lời trễ: tin lấy bù (đã ghi lịch sử, đã qua bộ lọc) chờ ở đây,
 * rồi được nhả TỪNG hội thoại vào bộ gộp tin (`enqueueMessage` - lo khoá thread,
 * tin chen, trần batch như mọi lượt), cách nhau một nhịp ngẫu nhiên. Sau một lần
 * mất kết nối dài, cả chục người được trả lời dồn trong vài giây là kiểu dễ bị
 * Zalo gắn cờ.
 *
 * Chỉ sống trong RAM (người dùng chốt): restart giữa lúc nhả thì thread còn chờ
 * không được trả lời - `dungVaBaoBoDo` log tên từng thread để chủ bot tự nhắn.
 */
export class HangChoTraLoiTre {
  private readonly log;
  private readonly cho = new Map<string, ParsedMessage[]>();
  /** Giờ gửi tin mới nhất của CHÍNH tài khoản trong thread (thấy qua lấy bù) */
  private readonly selfLuc = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dangNha = false;
  private daDung = false;

  constructor(
    private readonly deps: {
      accountId: string;
      enqueue: (threadKey: string, msg: ParsedMessage) => void;
      gianCachMs: () => [number, number];
      /** Thread bị bỏ lượt mà tin có ảnh: tải + gắn ảnh như nhánh chạm trần của router */
      luuAnhTinBoQua: (msgs: ParsedMessage[]) => void;
      random?: () => number;
    },
  ) {
    this.log = createLogger(`tra-loi-tre:${deps.accountId}`);
  }

  them(threadKey: string, msg: ParsedMessage): void {
    if (this.daDung) return;
    const ds = this.cho.get(threadKey) ?? [];
    ds.push(msg);
    this.cho.set(threadKey, ds);
  }

  ghiNhanTinSelf(threadKey: string, sentAt: string): void {
    const luc = Date.parse(sentAt);
    if (Number.isNaN(luc)) return;
    this.selfLuc.set(threadKey, Math.max(luc, this.selfLuc.get(threadKey) ?? Number.NEGATIVE_INFINITY));
  }

  /** Bắt đầu / tiếp tục nhả tuần tự. Đang nhả thì không làm gì (gọi nhiều lần được). */
  nha(): void {
    if (this.daDung || this.dangNha) return;
    this.dangNha = true;
    this.buoc();
  }

  /**
   * Người đang chờ vừa nhắn tin TRỰC TIẾP: đẩy ngay tin chờ của họ vào bộ gộp,
   * TRƯỚC tin trực tiếp, để một lượt thấy cả hai (vẫn mang cờ trễ). Không bỏ
   * lượt theo tin self: người ta đang nhắn thì phải trả lời.
   */
  nhaNgay(threadKey: string): boolean {
    const ds = this.cho.get(threadKey);
    if (this.daDung || !ds) return false;
    this.cho.delete(threadKey);
    this.selfLuc.delete(threadKey);
    this.dayVao(threadKey, ds);
    return true;
  }

  dungVaBaoBoDo(): string[] {
    this.daDung = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const boDo = [...this.cho.keys()];
    if (boDo.length > 0) {
      const ds = boDo.map((tk) => ({ threadKey: tk, nguoiGui: this.cho.get(tk)?.at(-1)?.senderName ?? "?" }));
      this.log.warn(
        { soThread: boDo.length, ds },
        "Dừng giữa lúc nhả hàng chờ trả lời trễ - các hội thoại này KHÔNG được trả lời, hãy tự nhắn",
      );
    }
    this.cho.clear();
    return boDo;
  }

  soThreadDangCho(): number {
    return this.cho.size;
  }

  private buoc(): void {
    this.timer = null;
    for (;;) {
      const tk = this.threadSomNhat();
      if (!tk) {
        this.dangNha = false;
        return;
      }
      const ds = [...(this.cho.get(tk) ?? [])].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
      this.cho.delete(tk);
      const self = this.selfLuc.get(tk);
      this.selfLuc.delete(tk);
      const cuoi = Date.parse(ds.at(-1)?.sentAt ?? "");
      if (self !== undefined && self > cuoi) {
        // Tài khoản đã nhắn SAU tin chờ cuối (thường là chủ trả lời tay trên điện thoại):
        // không trả lời chồng, không tốn nhịp giãn
        this.log.info({ threadKey: tk }, "Đã có tin của tài khoản sau tin lỡ - không trả lời trễ");
        this.an("lưu ảnh tin bỏ lượt", () => this.deps.luuAnhTinBoQua(ds));
        continue;
      }
      this.dayVao(tk, ds);
      this.timer = setTimeout(() => this.buoc(), this.nhip());
      return;
    }
  }

  private dayVao(threadKey: string, ds: ParsedMessage[]): void {
    for (const msg of ds) this.an("đưa tin vào bộ gộp", () => this.deps.enqueue(threadKey, msg));
  }

  private threadSomNhat(): string | undefined {
    let tot: string | undefined;
    let som = Number.POSITIVE_INFINITY;
    for (const [tk, ds] of this.cho) {
      const luc = Math.min(...ds.map((m) => Date.parse(m.sentAt)).filter((n) => !Number.isNaN(n)));
      if (tot === undefined || luc < som) {
        tot = tk;
        som = luc;
      }
    }
    return tot;
  }

  /** Nhịp ngẫu nhiên trong [min, max]; chuẩn hóa vì nút "Về mặc định" lách được luật chéo */
  private nhip(): number {
    let a = 0;
    let b = 0;
    this.an("đọc nhịp giãn", () => ([a, b] = this.deps.gianCachMs()));
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.max(a, b, lo);
    return lo + Math.floor((this.deps.random ?? Math.random)() * (hi - lo));
  }

  private an(viec: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log.warn({ err }, `Trả lời trễ: ${viec} hỏng - bỏ qua`);
    }
  }
}
