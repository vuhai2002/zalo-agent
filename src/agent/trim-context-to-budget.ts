import type { ModelMessage } from "ai";
import { uocLuongTokenTinNhan } from "./token-estimate.js";

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
   */
  soTinBaoVeCuoi: number;
}): KetQuaCat {
  const { tinNhan, tranToken, soTinBaoVeCuoi } = input;
  const tokenTruoc = uocLuongTokenTinNhan(tinNhan);
  if (tranToken <= 0 || tokenTruoc <= tranToken) {
    return { tinNhan, daCat: null };
  }

  // Chỉ số tin đầu tiên thuộc vùng được bảo vệ
  const moBaoVe = Math.max(0, tinNhan.length - Math.max(0, soTinBaoVeCuoi));
  let ds = [...tinNhan];
  let soAnhBo = 0;
  let soTinBo = 0;

  // Bước 1: bỏ ảnh, từ tin CŨ NHẤT đi tới, dừng ngay khi đã đủ chỗ
  for (let i = 0; i < moBaoVe && uocLuongTokenTinNhan(ds) > tranToken; i++) {
    const { tin, soAnhBo: bo } = boAnhKhoiTin(ds[i]!);
    if (bo > 0) {
      ds[i] = tin;
      soAnhBo += bo;
    }
  }

  // Bước 2: vẫn vượt thì bỏ hẳn tin cũ nhất, vẫn chừa vùng bảo vệ
  let dau = 0;
  while (dau < moBaoVe && uocLuongTokenTinNhan(ds) > tranToken) {
    dau++;
    soTinBo++;
    ds = ds.slice(1);
    // `ds` ngắn đi nên mốc bảo vệ trong `ds` dịch theo - vòng lặp dùng `dau` so
    // với `moBaoVe` gốc nên vẫn đếm đúng số tin đã bỏ
  }

  // Cắt hết mức vẫn vượt: trả về vùng bảo vệ chứ KHÔNG trả mảng rỗng. Lượt vẫn
  // nên chạy với đúng câu người dùng vừa hỏi, thà tràn còn hơn gửi rỗng.
  return {
    tinNhan: ds,
    daCat: { soAnhBo, soTinBo, tokenTruoc, tokenSau: uocLuongTokenTinNhan(ds) },
  };
}
