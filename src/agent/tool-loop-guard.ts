import { bamNgan, chuanHoaJson, chuKyLenhGoi } from "./tool-call-signature.js";
import { laKetQuaLoi } from "./tools/tool-failure-result.js";

/**
 * Chặn vòng lặp tool vô ích trong MỘT lượt agent.
 *
 * Trước module này, chặn trên duy nhất là `stepCountIs(8)`: model gọi
 * `web_fetch` cùng một URL lỗi 5 lần liên tiếp thì đốt 5/8 step, không ai chặn,
 * người dùng ngồi đợi rồi nhận câu trả lời cụt.
 *
 * Ba loại lặp tách riêng vì cách chữa khác nhau (mô hình `tool_guardrails.py`
 * của Hermes):
 *
 *   - `loi-giong-het`   cùng tool + cùng tham số + lại lỗi. Thử lại y hệt là vô
 *                       vọng, chặn sớm nhất.
 *   - `cung-tool-loi`   cùng tool lỗi với tham số khác nhau. Còn có thể là đang
 *                       dò, nên ngưỡng cao hơn.
 *   - `khong-tien-trien` tool CHỈ ĐỌC trả về CÙNG một kết quả lặp lại. Không phải
 *                       lỗi, nhưng cũng không thêm được gì.
 *
 * Module THUẦN: không đọc env, không chạm DB, không log. Ngưỡng và cách nhận
 * biết tool đọc đều tiêm từ ngoài vào, nên test được đủ nhánh mà không cần
 * model. Quyết định trả về là DỮ LIỆU - caller tự chọn biến nó thành log cảnh
 * báo hay điều kiện dừng.
 */

// Re-export: chữ ký là một phần của hợp đồng module này, người đọc không cần
// biết nó nằm ở file nào
export { chuKyLenhGoi } from "./tool-call-signature.js";

export type MucQuyetDinh = "cho-qua" | "canh-bao" | "chan";

export type QuyetDinh = {
  muc: MucQuyetDinh;
  /** Mã ngắn để lọc log; rỗng khi cho qua */
  ma: "" | "loi-giong-het" | "cung-tool-loi" | "khong-tien-trien";
  thongDiep: string;
  tool: string;
  soLan: number;
};

const CHO_QUA: QuyetDinh = { muc: "cho-qua", ma: "", thongDiep: "", tool: "", soLan: 0 };

export type NguongGuard = {
  /** Cùng tool + cùng tham số + lại lỗi */
  chanLoiGiongHet: number;
  /** Cùng tool lỗi, tham số khác nhau */
  chanCungToolLoi: number;
  /** Tool đọc trả cùng kết quả lặp lại */
  chanKhongTienTrien: number;
};

/**
 * Hình dạng TỐI THIỂU của một step mà guard cần đọc - khai theo cấu trúc chứ
 * không import type của AI SDK, để test dựng object tay được.
 *
 * Đọc CẢ HAI nguồn là bắt buộc, và trong repo này thì nguồn thứ hai mới là
 * nguồn CHÍNH:
 *
 *   - `content` dạng `tool-error`: chỉ có khi `execute` NÉM. Ở đây gần như
 *     không bao giờ xảy ra - mọi tool đều bắt lỗi rồi trả câu cho model
 *     (quyết định có chủ đích, xem `tools/tool-failure-result.ts`). Còn đọc vì
 *     lỗi TẦNG SDK vẫn đi đường này: schema chặn input sai, model bịa tên tool.
 *   - `toolResults` có `output` đánh dấu hỏng: đây là mọi lỗi NGHIỆP VỤ thật.
 *
 * Bản đầu chỉ đếm `tool-error` nên hai trong ba bộ đếm là code chết: `web_fetch`
 * hỏng trên 8 URL khác nhau đốt trọn trần step mà guard không hé răng.
 */
export type BuocDaChay = {
  toolResults?: readonly { toolName?: string; input?: unknown; output?: unknown }[];
  content?: readonly { type?: string; toolName?: string; input?: unknown }[];
};

export class ToolLoopGuard {
  private demLoiGiongHet = new Map<string, number>();
  private demCungToolLoi = new Map<string, number>();
  /** chữ ký -> [băm kết quả gần nhất, số lần lặp lại kết quả đó] */
  private demKhongTienTrien = new Map<string, [string, number]>();
  private quyetDinhChan: QuyetDinh | null = null;

  constructor(
    private readonly nguong: NguongGuard,
    /** Tool chỉ đọc mới áp luật "không tiến triển" - ghi 2 lần khác nhau là hợp lệ */
    private readonly laToolChiDoc: (tenTool: string) => boolean,
  ) {}

  /** Đã chốt chặn chưa. Dính: đã chặn thì các step sau vẫn trả true. */
  daChan(): boolean {
    return this.quyetDinhChan !== null;
  }

  lyDoChan(): QuyetDinh | null {
    return this.quyetDinhChan;
  }

  /**
   * Xóa sạch bộ đếm. Gọi khi bắt đầu một LẦN CHẠY mới trong cùng lượt (retry
   * completion rỗng, dựng lại input không kèm pixel) - lần chạy mới là ngữ cảnh
   * mới, không được mang tội của lần trước sang.
   */
  datLai(): void {
    this.demLoiGiongHet.clear();
    this.demCungToolLoi.clear();
    this.demKhongTienTrien.clear();
    this.quyetDinhChan = null;
  }

  /** Ghi nhận một step vừa chạy xong, trả về quyết định NGHIÊM TRỌNG NHẤT của step đó */
  ghiNhan(buoc: BuocDaChay): QuyetDinh {
    let nang = CHO_QUA;
    const nhan = (q: QuyetDinh) => {
      if (q.muc === "chan" && !this.quyetDinhChan) this.quyetDinhChan = q;
      if (q.muc === "chan" || (q.muc === "canh-bao" && nang.muc === "cho-qua")) nang = q;
    };

    for (const p of buoc.content ?? []) {
      if (p.type !== "tool-error" || !p.toolName) continue;
      nhan(this.demLoi(p.toolName, p.input));
    }
    for (const r of buoc.toolResults ?? []) {
      if (!r.toolName) continue;
      // Kết quả đánh dấu hỏng đi vào bộ đếm LỖI, không phải bộ "không tiến
      // triển". Hai nhánh này chữa bằng hai cách khác nhau, và gộp nhầm còn đẻ
      // ra câu chẩn đoán sai hướng: `web_fetch` chết cùng một URL 5 lần từng bị
      // báo là "trả cùng một kết quả, gọi thêm không có gì mới" - đọc như thể
      // trang vẫn sống mà chỉ nhàm.
      if (laKetQuaLoi(r.output)) {
        nhan(this.demLoi(r.toolName, r.input));
        continue;
      }
      nhan(this.demKetQua(r.toolName, r.input, r.output));
    }
    return nang;
  }

  private demLoi(tenTool: string, args: unknown): QuyetDinh {
    const chuKy = chuKyLenhGoi(tenTool, args);

    const nGiongHet = (this.demLoiGiongHet.get(chuKy) ?? 0) + 1;
    this.demLoiGiongHet.set(chuKy, nGiongHet);
    const nCungTool = (this.demCungToolLoi.get(tenTool) ?? 0) + 1;
    this.demCungToolLoi.set(tenTool, nCungTool);

    if (nGiongHet >= this.nguong.chanLoiGiongHet) {
      return {
        muc: "chan",
        ma: "loi-giong-het",
        tool: tenTool,
        soLan: nGiongHet,
        thongDiep: `${tenTool} lỗi ${nGiongHet} lần với ĐÚNG một bộ tham số - thử lại y hệt là vô vọng.`,
      };
    }
    if (nCungTool >= this.nguong.chanCungToolLoi) {
      return {
        muc: "chan",
        ma: "cung-tool-loi",
        tool: tenTool,
        soLan: nCungTool,
        thongDiep: `${tenTool} lỗi ${nCungTool} lần liên tiếp trong một lượt.`,
      };
    }
    if (nGiongHet >= canhBaoTu(this.nguong.chanLoiGiongHet)) {
      return {
        muc: "canh-bao",
        ma: "loi-giong-het",
        tool: tenTool,
        soLan: nGiongHet,
        thongDiep: `${tenTool} đã lỗi ${nGiongHet} lần với cùng tham số.`,
      };
    }
    return CHO_QUA;
  }

  private demKetQua(tenTool: string, args: unknown, ketQua: unknown): QuyetDinh {
    // Chỉ tool ĐỌC mới áp luật này. Tool ghi gọi 2 lần ra cùng kết quả là hợp
    // lệ (gửi 2 file giống nhau, thả 2 reaction giống nhau).
    if (!this.laToolChiDoc(tenTool)) return CHO_QUA;

    const chuKy = chuKyLenhGoi(tenTool, args);
    const bamKq = bamNgan(chuanHoaJson(ketQua ?? null));
    const truoc = this.demKhongTienTrien.get(chuKy);
    const n = truoc && truoc[0] === bamKq ? truoc[1] + 1 : 1;
    this.demKhongTienTrien.set(chuKy, [bamKq, n]);

    if (n >= this.nguong.chanKhongTienTrien) {
      return {
        muc: "chan",
        ma: "khong-tien-trien",
        tool: tenTool,
        soLan: n,
        thongDiep: `${tenTool} trả về CÙNG một kết quả ${n} lần - gọi thêm không có gì mới.`,
      };
    }
    if (n >= canhBaoTu(this.nguong.chanKhongTienTrien)) {
      return {
        muc: "canh-bao",
        ma: "khong-tien-trien",
        tool: tenTool,
        soLan: n,
        thongDiep: `${tenTool} đã trả cùng kết quả ${n} lần.`,
      };
    }
    return CHO_QUA;
  }
}

/**
 * Ngưỡng cảnh báo suy ra từ ngưỡng chặn thay vì thêm 3 biến cấu hình nữa.
 * Tối thiểu 2 để lần lỗi ĐẦU không bao giờ bị cảnh báo - lỗi một lần là chuyện
 * thường, chưa phải vòng lặp.
 */
export function canhBaoTu(nguongChan: number): number {
  return Math.max(2, Math.floor(nguongChan / 2));
}

/**
 * Kẹp ngưỡng xuống dưới trần step, vì một ngưỡng cao bằng trần step là ngưỡng
 * KHÔNG BAO GIỜ tới lượt.
 *
 * Ba số mặc định (5/8/5) bê nguyên từ `tool_guardrails.py` của Hermes - nhưng bê
 * thiếu ngữ cảnh: ở Hermes `max_iterations` mặc định là **90**, nên 8 chỉ là 9%
 * ngân sách. Ở đây `LLM_MAX_STEPS` mặc định là **8**, nên ngưỡng 8 đứng đúng
 * bằng trần: mỗi step một lệnh gọi thì `stepCountIs` luôn dừng trước, bộ đếm
 * chạm 8 là chuyện không thể xảy ra.
 *
 * Kẹp ở đây chứ không hạ mặc định trong env: người đặt `LLM_MAX_STEPS=30` vẫn
 * được đúng ba con số của Hermes, còn người để mặc định thì guard vẫn nổ được.
 * Sàn 2 để không kẹp xuống 1 - chặn ngay lần lỗi đầu là quá tay.
 */
export function nguongTheoTranStep(nguong: NguongGuard, tranStep: number): NguongGuard {
  const kep = (n: number) => Math.max(2, Math.min(n, tranStep - 1));
  return {
    chanLoiGiongHet: kep(nguong.chanLoiGiongHet),
    chanCungToolLoi: kep(nguong.chanCungToolLoi),
    chanKhongTienTrien: kep(nguong.chanKhongTienTrien),
  };
}
