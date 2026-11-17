import type { PhanNoiDung } from "../../attachments/attachment-extract-types.js";
import type { KetQuaOcr } from "../../attachments/ocr-cac-trang.js";
import { wrapUntrustedContent } from "./wrap-untrusted-content.js";

/**
 * Dựng chuỗi kết quả của tool `doc_file`. Hàm thuần.
 *
 * Hai vùng, ranh giới không được nhòe:
 *  - PHẦN ĐẦU (vùng model tin): chỉ chữ do máy chủ dựng - số tệp, định dạng,
 *    số trang, trang đã/chưa OCR, cảnh báo, cách đọc tiếp. Cảnh báo phải ở ĐẦU
 *    vì kết quả bị chia đoạn - để cuối là model có khi không bao giờ đọc tới.
 *  - KHỐI NONCE: mọi chuỗi của người lạ - TÊN TỆP, tên sheet, tiêu đề cột, chữ
 *    trong tệp. Bài học `tacGia` của tool video: chuỗi người lạ đặt mà nằm ở
 *    vùng tin cậy là đóng được nhãn thật rồi mở nhãn giả.
 */

export type DuLieuDocTep = {
  tepSo: number;
  ten: string;
  dinhDang: string;
  soTrang: number | null;
  noiDung: PhanNoiDung[];
  trangDaOcr: number[];
  trangChuaOcr: number[];
  trangVuotTran: number[];
  boQuaOcr: KetQuaOcr["boQua"];
  canhBao: string[];
  tuKyTu: number;
  tranKyTu: number;
  /** Dải trang model xin (tool tham số `trang`) - có thì chỉ hiện các trang này */
  daiTrang?: [number, number];
  /**
   * Chỉ trong NHÓM: tệp do chính người đang hỏi gửi hay người khác. `tepSo`
   * đếm mọi tệp của thread (kể cả thành viên chưa xác minh), nên "đọc tệp tôi
   * vừa gửi" có thể trỏ nhầm sang tệp người khác gửi chen vào - dòng này là do
   * máy chủ dựng, model dùng nó để kiểm lại trước khi trả lời.
   */
  nguoiGui?: "nguoi-hoi" | "nguoi-khac";
};

/** Số trang đề nghị đọc thêm mỗi lần gọi lại */
const SO_TRANG_GOI_Y_MOI_LAN = 10;

/** [1,2,3,5,6] -> "1-3, 5-6" */
export function gopDaiTrang(so: number[]): string {
  const ds = [...so].sort((a, b) => a - b);
  const ra: string[] = [];
  for (let i = 0; i < ds.length; ) {
    let j = i;
    while (j + 1 < ds.length && ds[j + 1] === ds[j]! + 1) j++;
    ra.push(i === j ? `${ds[i]}` : `${ds[i]}-${ds[j]}`);
    i = j + 1;
  }
  return ra.join(", ");
}

const LY_DO_BO_QUA: Record<KetQuaOcr["boQua"][number]["lyDo"], string> = {
  "chua-cau-hinh": "chưa bật model đọc ảnh (sidecar) nên chưa chép được",
  "het-tran-gio": "hết suất chép trang quét trong giờ này, thử lại sau",
  loi: "chép lỗi, thử lại sau",
};

function phanDau(d: DuLieuDocTep): string[] {
  const dong: string[] = [];
  const trang = d.soTrang ? ` | ${d.soTrang} trang` : "";
  const ocr = d.trangDaOcr.length > 0 ? ` | đã OCR ${gopDaiTrang(d.trangDaOcr)}/${d.soTrang ?? "?"}` : "";
  dong.push(`Tệp số ${d.tepSo} | ${d.dinhDang}${trang}${ocr}`);
  if (d.nguoiGui === "nguoi-hoi") dong.push("Người gửi tệp: chính người đang hỏi.");
  if (d.nguoiGui === "nguoi-khac") {
    dong.push(
      "Người gửi tệp: người KHÁC trong nhóm, không phải người đang hỏi. Nếu người hỏi nói tới tệp CỦA HỌ thì đây có thể là nhầm tệp - thử tepSo khác hoặc hỏi lại họ.",
    );
  }
  for (const c of d.canhBao) dong.push(`Cảnh báo: ${c}`);
  if (d.trangChuaOcr.length > 0) {
    const tiep = d.trangChuaOcr.slice(0, SO_TRANG_GOI_Y_MOI_LAN);
    dong.push(
      `Trang quét CHƯA chép chữ: ${gopDaiTrang(d.trangChuaOcr)}. Cần nội dung các trang đó thì gọi lại doc_file với trang="${tiep[0]}-${tiep[tiep.length - 1]}".`,
    );
  }
  if (d.trangVuotTran.length > 0) {
    dong.push(
      `Trang ${gopDaiTrang(d.trangVuotTran)} vượt số trang quét tối đa mỗi tệp - KHÔNG đọc được; nói thật với người dùng và nhờ họ chỉ ra trang cần (gửi ảnh chụp trang đó).`,
    );
  }
  const theoLyDo = new Map<string, number[]>();
  for (const b of d.boQuaOcr) theoLyDo.set(LY_DO_BO_QUA[b.lyDo], [...(theoLyDo.get(LY_DO_BO_QUA[b.lyDo]) ?? []), b.so]);
  for (const [lyDo, so] of theoLyDo) dong.push(`Trang ${gopDaiTrang(so)}: ${lyDo}.`);
  if (d.noiDung.some((p) => p.thongKe)) {
    dong.push(
      'Cuối mỗi sheet Excel có dòng số liệu do máy chủ tính: chỉ cộng ô kiểu số, bỏ ô công thức (thường là dòng TỔNG). Dùng số đó thay vì tự cộng; cột ngày cũng là số trong Excel nên tổng của cột ngày là vô nghĩa; bảng có dòng tổng GÕ TAY thì tổng bị tính trùng - kiểm lại trước khi báo.',
    );
  }
  return dong;
}

function vanBanMotPhan(p: PhanNoiDung): string {
  const tk = p.thongKe
    ? `\nThống kê máy chủ tự cộng: ${p.thongKe.soHangDuLieu} dòng dữ liệu; ` +
      (p.thongKe.cot.length > 0 ? p.thongKe.cot.map((c) => `${c.cot} = ${c.tong} (${c.soO} ô)`).join("; ") : "không có cột số") +
      (p.thongKe.soOCongThuc > 0 ? `; bỏ qua ${p.thongKe.soOCongThuc} ô công thức` : "")
    : "";
  return `=== ${p.nhan}${p.nguon === "ocr" ? " (chép từ ảnh quét)" : ""} ===\n${p.chu}${tk}`;
}

/** "Trang 12 ..." -> 12; phần không có số trang (docx, sheet) -> null */
function soTrangCuaNhan(nhan: string): number | null {
  const m = /^Trang (\d+)/.exec(nhan);
  return m ? Number(m[1]) : null;
}

/** Cắt `[tu, tu + tran)` nhưng không xẻ đôi một cặp surrogate (emoji) ở cuối */
function catAnToan(s: string, tu: number, tran: number): string {
  let ket = Math.min(s.length, tu + tran);
  const cuoi = s.charCodeAt(ket - 1);
  if (ket < s.length && cuoi >= 0xd800 && cuoi <= 0xdbff) ket--;
  return s.slice(tu, ket);
}

export function dungKetQuaDocTep(d: DuLieuDocTep): string {
  // Có dải trang: CHỈ các trang trong dải - không thì trang xin (vd trang quét
  // 80 của PDF 100 trang) nằm sau 30.000 ký tự đầu và model không bao giờ thấy,
  // trong khi phần đầu lại báo "đã OCR trang 80" -> dễ bịa nội dung.
  const phan = d.daiTrang
    ? d.noiDung.filter((p) => {
        const so = soTrangCuaNhan(p.nhan);
        return so !== null && so >= d.daiTrang![0] && so <= d.daiTrang![1];
      })
    : d.noiDung;
  const toanVan = phan.map(vanBanMotPhan).join("\n\n");
  const doan = catAnToan(toanVan, d.tuKyTu, d.tranKyTu);
  const ketThuc = d.tuKyTu + doan.length;
  const dau = phanDau(d);
  if (d.daiTrang) dau.push(`Đang hiện riêng trang ${d.daiTrang[0]}-${d.daiTrang[1]}.`);
  if (d.tuKyTu > 0 && d.tuKyTu >= toanVan.length) {
    dau.push(`Đã hết nội dung (phần này có ${toanVan.length} ký tự) - không còn gì để đọc tiếp.`);
  } else if (ketThuc < toanVan.length) {
    dau.push(`Đang hiện ký tự ${d.tuKyTu}-${ketThuc}/${toanVan.length}. Đọc tiếp: gọi lại doc_file với tuKyTu=${ketThuc}${d.daiTrang ? ` và cùng trang` : ""}.`);
  }
  const khoi = `Tên tệp: ${JSON.stringify(d.ten)}\n\n${doan || "(không có chữ trong phần này)"}`;
  return `${dau.join("\n")}\n\n${wrapUntrustedContent(khoi, "tệp đính kèm")}`;
}
