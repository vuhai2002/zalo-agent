import type { ModelMessage } from "ai";
import { TOKEN_MOI_ANH_THEO_CO, uocLuongTokenTinNhan, type CoAnh } from "./token-estimate.js";

/**
 * Cắt bớt ngữ cảnh khi ước lượng vượt ngân sách token.
 *
 * Hàm THUẦN - không đọc env, không chạm DB, không log. Nhờ vậy test được đủ
 * nhánh mà không cần model hay filesystem.
 *
 * Thứ tự cắt CÓ CHỦ Ý:
 *   1. Bỏ ẢNH ở các tin cũ nhất trước. Ảnh là thứ nặng nhất trong ngữ cảnh
 *      (mỗi tấm bằng cả trăm dòng chữ), mà mất một tấm ảnh cũ ít hại hơn mất
 *      cả một lượt đối thoại.
 *   2. Rồi mới bỏ TIN cũ nhất.
 *
 * Hai thứ TUYỆT ĐỐI không cắt:
 *   - Tin của lượt hiện tại (`soTinBaoVeCuoi`): cắt vào đó là mất chính câu
 *     người dùng vừa hỏi, bot sẽ trả lời câu trước đó.
 *   - Không cắt GIỮA một tin. Nội dung web đã được bọc trong khối
 *     `<noi_dung_ngoai>`; cắt nửa chừng sẽ bỏ mất thẻ đóng và biến phần còn lại
 *     thành thứ model đọc như lời hệ thống - đúng lỗ hổng mà khối bọc đó sinh
 *     ra để bịt.
 *
 * Phần bị cắt không mất hẳn khỏi trí nhớ bot: `thread-summarizer.ts` vẫn gộp
 * tin cũ vào rolling summary theo đường riêng.
 */

export type KetQuaCat = {
  tinNhan: ModelMessage[];
  /** null = không phải cắt gì */
  daCat: {
    soAnhBo: number;
    soTinBo: number;
    tokenTruoc: number;
    tokenSau: number;
  } | null;
};

/** Bỏ mọi phần ảnh khỏi một tin, giữ nguyên phần chữ */
function boAnhKhoiTin(tin: ModelMessage): { tin: ModelMessage; soAnhBo: number } {
  if (!Array.isArray(tin.content)) return { tin, soAnhBo: 0 };

  const conLai = tin.content.filter((p) => p.type !== "file" && p.type !== "image");
  const soAnhBo = tin.content.length - conLai.length;
  if (soAnhBo === 0) return { tin, soAnhBo: 0 };

  // Chỉ còn đúng một phần chữ thì thu về chuỗi cho payload gọn
  if (conLai.length === 1 && conLai[0]!.type === "text") {
    return { tin: { ...tin, content: (conLai[0] as { text: string }).text } as ModelMessage, soAnhBo };
  }
  // Bỏ hết mà không còn gì: để lại dấu vết thay vì tin rỗng (provider từ chối
  // content rỗng, và model cũng nên biết là ở đây từng có ảnh)
  if (conLai.length === 0) {
    return { tin: { ...tin, content: "[ảnh cũ đã lược bớt cho gọn ngữ cảnh]" } as ModelMessage, soAnhBo };
  }
  return { tin: { ...tin, content: conLai } as ModelMessage, soAnhBo };
}

export function catNguCanhTheoNganSach(input: {
  tinNhan: ModelMessage[];
  /** Trần token cho phần input. Nhỏ hơn hoặc bằng 0 = không cắt gì. */
  tranToken: number;
  /**
   * Số tin CUỐI mảng thuộc lượt hiện tại - không bao giờ bị cắt. Caller
   * (`agent-turn-content.ts`) biết con số này vì chính nó ghép history với batch.
   *
   * Kẹp về tối thiểu 1: bất biến "không bao giờ trả mảng rỗng" ở cuối hàm chỉ
   * đứng vững khi vùng bảo vệ không rỗng. Truyền 0 hay số âm thì mọi tin đều
   * cắt được và hàm trả mảng rỗng - provider từ chối, cả lượt chết.
   */
  soTinBaoVeCuoi: number;
  /** Cỡ ảnh đang cấu hình - quyết định mỗi ảnh nặng bao nhiêu token */
  coAnh?: CoAnh;
}): KetQuaCat {
  const { tinNhan, tranToken, soTinBaoVeCuoi } = input;
  const tokenMoiAnh = TOKEN_MOI_ANH_THEO_CO[input.coAnh ?? "normal"];
  const tokenTruoc = uocLuongTokenTinNhan(tinNhan, tokenMoiAnh);
  if (tranToken <= 0 || tokenTruoc <= tranToken) {
    return { tinNhan, daCat: null };
  }

  // Chỉ số tin đầu tiên thuộc vùng được bảo vệ
  const moBaoVe = Math.max(0, tinNhan.length - Math.max(1, soTinBaoVeCuoi));
  let ds = [...tinNhan];
  let soAnhBo = 0;
  let soTinBo = 0;

  // Bước 1: bỏ ảnh, từ tin CŨ NHẤT đi tới, dừng ngay khi đã đủ chỗ
  for (let i = 0; i < moBaoVe && uocLuongTokenTinNhan(ds, tokenMoiAnh) > tranToken; i++) {
    const { tin, soAnhBo: bo } = boAnhKhoiTin(ds[i]!);
    if (bo > 0) {
      ds[i] = tin;
      soAnhBo += bo;
    }
  }

  // Bước 2: vẫn vượt thì bỏ hẳn tin cũ nhất, vẫn chừa vùng bảo vệ
  let dau = 0;
  while (dau < moBaoVe && uocLuongTokenTinNhan(ds, tokenMoiAnh) > tranToken) {
    dau++;
    soTinBo++;
    ds = ds.slice(1);
    // `ds` ngắn đi nên mốc bảo vệ trong `ds` dịch theo - vòng lặp dùng `dau` so
    // với `moBaoVe` gốc nên vẫn đếm đúng số tin đã bỏ
  }

  // Bỏ tin `tool` MỒ CÔI ở đầu mảng.
  //
  // Vòng trên cắt theo CHỈ SỐ, không biết gì về ràng buộc `assistant(tool-call)`
  // phải đi liền `tool(tool-result)`. Chỉ cần nó dừng ngay sau khi bỏ một tin
  // assistant là mảng còn lại mở đầu bằng một tool-result không có lệnh gọi
  // tương ứng - OpenAI trả 400 "messages with role 'tool' must be a response to
  // a preceeding message with 'tool_calls'", Anthropic trả 400 "unexpected
  // tool_result block". Đo thật: 42/48 tổ hợp thăm dò rơi vào đúng hình dạng đó
  // (assistant nặng vì text dài + tool-call, còn tool-result thì nhẹ).
  //
  // Đường này chỉ với tới được qua lượt chốt (`runWrapUp`) - mảng của
  // `buildTurnMessages` không có tin `tool` nào.
  while (ds.length > 0 && ds[0]!.role === "tool") {
    ds = ds.slice(1);
    soTinBo++;
  }

  // Cắt hết mức vẫn vượt: trả về vùng bảo vệ chứ KHÔNG trả mảng rỗng. Lượt vẫn
  // nên chạy với đúng câu người dùng vừa hỏi, thà tràn còn hơn gửi rỗng.
  //
  // Vượt trần nhưng KHÔNG cắt được gì (vùng bảo vệ phủ hết mảng) thì trả `null`
  // như lúc không phải cắt: báo `daCat` với toàn số 0 sẽ in ra dòng log "đã cắt
  // bớt" trong khi không bỏ đi thứ gì.
  if (soAnhBo === 0 && soTinBo === 0) return { tinNhan: ds, daCat: null };
  return {
    tinNhan: ds,
    daCat: { soAnhBo, soTinBo, tokenTruoc, tokenSau: uocLuongTokenTinNhan(ds, tokenMoiAnh) },
  };
}
