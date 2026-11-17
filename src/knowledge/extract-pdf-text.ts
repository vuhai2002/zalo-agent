import { getDocumentProxy, registerImageDecoders } from "unpdf";
import type { ThongTinTrang } from "../attachments/phan-loai-trang-pdf.js";

/**
 * Đọc chữ PDF bằng `unpdf` 2.x, TỪNG TRANG một, dừng ở trần trang/ký tự.
 *
 * Vì sao không `extractText(mergePages)` như trước: nó đọc trọn mọi trang
 * rồi mới trả, nên một PDF vài nghìn trang (hoặc trang có luồng nội dung
 * phình) giữ cả đống chữ trong RAM trước khi ai kịp cắt. Đọc theo trang thì
 * dừng được ngay khi đủ, và `page.cleanup()` nhả tài nguyên sau mỗi trang.
 *
 * Module THUẦN (không chạm env/DB) vì nó chạy trong tiến trình con đọc tài liệu.
 */

export type TrangPdf = { so: number; chu: string };
export type KetQuaDocPdf = {
  soTrang: number;
  trang: TrangPdf[];
  catBot: boolean;
  /** Chỉ khi gọi với `phanLoai: true` - một phần tử mỗi trang đã đọc */
  thongTin?: ThongTinTrang[];
};


/** Lỗi đọc PDF có mã - chở qua ranh giới tiến trình con bằng `ma`, không bằng chữ */
export class LoiDocPdf extends Error {
  constructor(
    readonly ma: "mat-khau" | "hong",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Trần ảnh pdf.js chịu giải mã (điểm ảnh). 16 MP đủ cho trang A4 quét 300 dpi
 * (~8,7 MP); ảnh to hơn bị pdf.js bỏ qua thay vì giải mã ra hàng trăm MB.
 */
const TRAN_ANH_DIEM = 16_777_216;

/**
 * @param tranAnhDiem trần điểm ảnh pdf.js chịu giải mã. Đọc chữ giữ 16 MP; đường
 * render OCR nâng lên (trang quét 600 dpi A4 ~35 MP) - pdf.js bỏ ÂM THẦM ảnh
 * vượt trần nên trần thấp ở đó là trang quét render ra trắng. Trần RSS của
 * tiến trình con mới là cầu dao bộ nhớ thật.
 */
export async function moPdf(buf: Buffer, tranAnhDiem = TRAN_ANH_DIEM) {
  // Bộ giải mã ảnh CCITT/JBIG2/JPEG2000 (WASM) - unpdf 2.x tách khỏi gói chỉ
  // đọc chữ; trang quét đen trắng cần nó để dựng danh sách lệnh vẽ và render
  registerImageDecoders();
  try {
    // Không cần `isEvalSupported: false`: pdf.js 6.x đã bỏ hẳn tùy chọn này vì
    // glyph được dựng thành dữ liệu path, không còn qua `new Function` (đường
    // của họ CVE font-eval 2024).
    // View, không sao chép: tệp đã nằm 1 bản trong RAM của tiến trình con, mỗi
    // bản sao thêm là thêm cỡ cả tệp vào trần RSS (đo: PDF 41 MB vượt trần 320 MB
    // chỉ vì 3 bản sao). Đã kiểm pdf.js không detach buffer truyền vào.
    return await getDocumentProxy(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
      maxImageSize: tranAnhDiem,
      enableXfa: false,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "PasswordException") {
      throw new LoiDocPdf("mat-khau", "PDF này có mật khẩu, chưa đọc được");
    }
    const chiTiet = err instanceof Error ? err.message : String(err);
    throw new LoiDocPdf("hong", `PDF này hỏng, không đọc được: ${chiTiet}`);
  }
}

/** Lỗi thô của pdf.js khi đọc giữa chừng -> câu tiếng Việt cho người vận hành */
function boLoiPdf(err: unknown): never {
  if (err instanceof LoiDocPdf) throw err;
  const chiTiet = err instanceof Error ? err.message : String(err);
  throw new LoiDocPdf("hong", `PDF này hỏng, không đọc được: ${chiTiet}`);
}

export async function docTrangPdf(
  buf: Buffer,
  tran: { tranTrang: number; tranKyTu: number; phanLoai?: boolean },
): Promise<KetQuaDocPdf> {
  const pdf = await moPdf(buf);
  const thongTin: ThongTinTrang[] = [];
  try {
    const trang: TrangPdf[] = [];
    let tongKyTu = 0;
    let catBot = false;
    for (let so = 1; so <= pdf.numPages; so++) {
      if (so > tran.tranTrang || tongKyTu >= tran.tranKyTu) {
        catBot = true;
        break;
      }
      const page = await pdf.getPage(so).catch(boLoiPdf);
      try {
        const noiDung = await page.getTextContent().catch(boLoiPdf);
        let chu = noiDung.items
          .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
          .join("");
        if (tongKyTu + chu.length > tran.tranKyTu) {
          chu = chu.slice(0, tran.tranKyTu - tongKyTu);
          catBot = true;
        }
        tongKyTu += chu.length;
        trang.push({ so, chu });
        // Chữ trong getTextContent gồm cả lớp OCR ẩn của máy quét - có là dùng được
        if (tran.phanLoai) thongTin.push({ so, doDaiChu: chu.replace(/\s/g, "").length });
      } finally {
        page.cleanup();
      }
    }
    return { soTrang: pdf.numPages, trang, catBot, ...(tran.phanLoai ? { thongTin } : {}) };
  } finally {
    // pdf.js 6.x bỏ `PDFDocumentProxy.destroy()`; hủy qua loadingTask
    await pdf.loadingTask.destroy();
  }
}

/** Gộp chữ các trang giống `normalizeMergedText` của unpdf - giữ y đầu ra cũ cho Kho tri thức */
export function gopChuCacTrang(trang: TrangPdf[]): string {
  return trang
    .map((t) => t.chu)
    .join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Bản cho Kho tri thức: gộp chữ mọi trang. Trần rộng (nguồn KB do người vận
 * hành tải lên, đã có trần dung lượng file) nhưng VẪN có trần.
 *
 * `unpdf` không ném khi PDF không có lớp chữ (ảnh quét) - nó trả rỗng - nên
 * phải tự nhận diện, không thì caller tưởng tài liệu thật sự trống.
 */
export async function extractPdfText(buf: Buffer): Promise<string> {
  const { soTrang, trang, catBot } = await docTrangPdf(buf, { tranTrang: 2000, tranKyTu: 10_000_000 });
  const text = gopChuCacTrang(trang);
  if (!text.trim()) {
    throw new Error("PDF này là ảnh quét, chưa đọc được chữ (chưa hỗ trợ OCR)");
  }
  // Cắt thì nói ra NGAY TRONG nội dung: người vận hành xem đoạn trên dashboard
  // thấy được, thay vì nguồn "Sẵn sàng" mà âm thầm thiếu phần sau.
  const ghiChu = `[Tài liệu dài hơn trần đọc: chỉ nạp ${trang.length}/${soTrang} trang đầu]`;
  return catBot ? `${text}

${ghiChu}` : text;
}
