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
  /**
   * Thread đã được `nhaNgay` trong lượt lấy bù hiện tại: tin lấy bù của nó tới
   * SAU (trang sau của cùng lượt) chỉ nằm trong lịch sử, không xếp lại - xếp lại
   * là một lượt trả lời trễ thứ hai, xin lỗi hai lần, trả lời tin cũ sau tin mới.
   * Xóa ở `batDauLuotMoi()` (một lượt lấy bù MỚI bắt đầu) - xóa ở cuối lượt là
   * để nó sống qua tới lượt sau và chặn mất tin lỡ của lần mất mạng kế tiếp.
   */
  private readonly daNhaNgay = new Set<string>();
  private dangNha = false;
  private daDung = false;

  constructor(
    private readonly deps: {
      accountId: string;
      /** `false` = bộ gộp từ chối (chạm trần batch) - tin đó đi đường lưu ảnh */
      enqueue: (threadKey: string, msg: ParsedMessage) => boolean;
      gianCachMs: () => [number, number];
      /** Thread bị bỏ lượt mà tin có ảnh: tải + gắn ảnh như nhánh chạm trần của router */
      luuAnhTinBoQua: (msgs: ParsedMessage[]) => void;
      random?: () => number;
      /** Trần tin một batch của bộ gộp (`TRAN_TIN_DON`) - mặc định 32 */
      tranTinMoiNguoi?: number;
    },
  ) {
    this.log = createLogger(`tra-loi-tre:${deps.accountId}`);
  }

  them(threadKey: string, msg: ParsedMessage): void {
    if (this.daDung || this.daNhaNgay.has(threadKey)) return;
    const ds = this.cho.get(threadKey) ?? [];
    ds.push(msg);
    this.cho.set(threadKey, ds);
  }

  /**
   * `lucMs` lấy từ `ts` THÔ của tin, không từ `sentAt` của parser: `sentAt` bị kẹp
   * về giờ nhận khi `ts` hỏng/quá cũ, mà "self lúc bây giờ" là bỏ lượt oan cả thread.
   */
  ghiNhanTinSelf(threadKey: string, lucMs: number): void {
    if (!Number.isFinite(lucMs)) return;
    this.selfLuc.set(threadKey, Math.max(lucMs, this.selfLuc.get(threadKey) ?? Number.NEGATIVE_INFINITY));
  }

  /** Gỡ một tin đang chờ (người gửi đã THU HỒI nó) - thread hết tin thì gỡ luôn thread */
  boTin(threadKey: string, msgId: string): void {
    const ds = this.cho.get(threadKey);
    if (!ds) return;
    const con = ds.filter((m) => m.msgId !== msgId);
    if (con.length > 0) this.cho.set(threadKey, con);
    else this.cho.delete(threadKey);
  }

  /** Bắt đầu / tiếp tục nhả tuần tự. Đang nhả thì không làm gì (gọi nhiều lần được). */
  /** Một lượt lấy bù mới bắt đầu (không gồm lượt chạy tiếp sau trần - cùng lượt) */
  batDauLuotMoi(): void {
    this.daNhaNgay.clear();
  }

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
    this.daNhaNgay.add(threadKey);
    this.cho.delete(threadKey);
    const self = this.selfLuc.get(threadKey);
    this.selfLuc.delete(threadKey);
    const sapXep = this.sapTheoGio(ds);
    if (self !== undefined && self > Date.parse(sapXep.at(-1)?.sentAt ?? "")) {
      // Chủ đã trả lời tay các tin cũ: chỉ tin trực tiếp mới đi, không trả lời lại tin cũ
      this.an("lưu ảnh tin bỏ lượt", () => this.deps.luuAnhTinBoQua(sapXep));
      return false;
    }
    this.dayVao(threadKey, sapXep);
    return true;
  }

  dungVaBaoBoDo(): string[] {
    this.daDung = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const boDo = [...this.cho.keys()];
    if (boDo.length > 0) {
      const ds = boDo.map((tk) => {
        const cuoi = this.cho.get(tk)?.at(-1);
        return { threadKey: tk, loai: cuoi?.isGroup ? "nhóm" : "1-1", nguoiGuiCuoi: cuoi?.senderName ?? "?" };
      });
      this.log.warn(
        { soThread: boDo.length, ds },
        "Dừng giữa lúc nhả hàng chờ trả lời trễ - các hội thoại này KHÔNG được trả lời, hãy tự nhắn",
      );
    }
    this.cho.clear();
    this.selfLuc.clear();
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
      const ds = this.sapTheoGio(this.cho.get(tk) ?? []);
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

  /**
   * Đẩy tin (đã sắp theo giờ gửi) vào bộ gộp. Bộ gộp gom theo NGƯỜI GỬI và từ chối
   * tin vượt trần batch - mà tin bị từ chối lại là tin MỚI NHẤT. Nên mỗi người chỉ
   * đẩy N tin mới nhất (phần cũ hơn đã có trong lịch sử, model vẫn đọc được); phần
   * bị bỏ hay bị từ chối đi đường lưu ảnh, như nhánh chạm trần của router.
   */
  private dayVao(threadKey: string, ds: ParsedMessage[]): void {
    const tran = this.deps.tranTinMoiNguoi ?? 32;
    const demTuCuoi = new Map<string, number>();
    const giu = new Set<ParsedMessage>();
    for (let i = ds.length - 1; i >= 0; i--) {
      const m = ds[i]!;
      const n = (demTuCuoi.get(m.senderId) ?? 0) + 1;
      demTuCuoi.set(m.senderId, n);
      if (n <= tran) giu.add(m);
    }
    const boQua = ds.filter((m) => !giu.has(m));
    for (const msg of ds) {
      if (!giu.has(msg)) continue;
      let nhan = false;
      this.an("đưa tin vào bộ gộp", () => (nhan = this.deps.enqueue(threadKey, msg)));
      if (!nhan) boQua.push(msg);
    }
    if (boQua.length > 0) this.an("lưu ảnh tin bỏ lượt", () => this.deps.luuAnhTinBoQua(boQua));
  }

  private sapTheoGio(ds: ParsedMessage[]): ParsedMessage[] {
    return [...ds].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
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
