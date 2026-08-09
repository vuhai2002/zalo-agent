/**
 * Toàn bộ hằng số trần cho đường đọc docx/xlsx (Kho tri thức) - MỘT chỗ duy
 * nhất, để chỉnh trần chỉ cần sửa file này.
 *
 * Căn cứ từng con số: `plans/260809-remediation-kho-tri-thuc/reports/
 * nghien-cuu-doc-ooxml-an-toan.md`, mục 5.6. Tóm tắt: container 768 MB cho bot
 * tự host -> Node old space 384 MB (`old_generation = physical/2`) dùng CHUNG
 * cho mọi tài khoản Zalo, ngân sách một lượt xử lý OOXML chỉ nên chiếm
 * khoảng 200 MB đỉnh. File Word/Excel thật đo được lớn nhất: entry đơn 7,13
 * MB, tổng giải nén 20,6 MB - mọi trần dưới đều cách xa con số đó vài lần.
 */

/**
 * Trần TỔNG dữ liệu giải nén của CẢ archive (cộng dồn mọi entry đọc trong
 * cùng một phiên) - trần DUY NHẤT bắt được mọi cách chia nhỏ archive. Repo
 * trước phase này chỉ có trần theo từng entry, không có trần này: `.xlsx`
 * đọc `sharedStrings.xml` CỘNG mọi `sheetN.xml`, chia đủ nhỏ thì từng entry
 * đều lọt trần mà tổng vẫn ra hàng trăm MB.
 *
 * 64 MB = headroom 3,1x so với 20,6 MB (tổng giải nén lớn nhất đo được trên
 * file thật). Nếu còn `.toString()` cả entry ở đâu đó (tiếng Việt ép two-byte
 * string), đỉnh xấu nhất 64 + 128 = 192 MB vẫn lọt ngân sách 200 MB.
 *
 * Ghi chú vận hành: nếu `docker stats` đo baseline RSS thật của prod cao hơn
 * ~120 MB (nhiều tài khoản Zalo cùng chạy), hạ hằng số này xuống 32-48 MB.
 */
export const TRAN_TONG_GIAI_NEN = 64 * 1024 * 1024;

/**
 * Trần MỘT entry - nửa trần tổng, đủ xa `document.xml` lớn nhất đo được
 * (7,13 MB, headroom 4,5x). Không entry nào được phép ăn quá nửa ngân sách
 * archive - chặn ca một sheet khổng lồ duy nhất.
 *
 * Thay hẳn `TRAN_GIAI_NEN_MAC_DINH` (300 MB) cũ của `read-zip-entry.ts` cho
 * riêng đường đọc OOXML - 300 MB gấp 42 lần entry lớn nhất từng đo, một mình
 * nó đã vượt ngân sách RAM của container nhỏ.
 */
export const TRAN_MOT_ENTRY = 32 * 1024 * 1024;

/**
 * Tỉ lệ giải nén / nén tối đa. Trần lý thuyết DEFLATE là 1032:1 (RFC 1951);
 * OOXML thật đo cao nhất 50,2x, file máy sinh thoái hoá (hàng lặp y hệt) tới
 * 292,9x. 500:1 nằm giữa 293 và 1028 - headroom 1,7x trên ca hợp lệ tệ nhất
 * mà vẫn bắt được bom thật.
 *
 * KHÔNG dùng 100:1 kiểu Apache POI: tiền lệ false positive hàng loạt trên
 * file Excel hợp lệ (Dataverse #7854, spark-excel #231) khiến người dùng tắt
 * hẳn kiểm tra này - trần quá chặt còn tệ hơn không có trần.
 */
export const TI_LE_NEN_TOI_DA = 500;

/**
 * Đọc CHƯA ĐỦ ngưỡng này (theo byte OUTPUT đã giải nén, KHÔNG phải cỡ nén
 * đầu vào) thì MIỄN kiểm tỉ lệ - entry nhỏ nhiễu mạnh (metadata, docProps...)
 * và không đe doạ gì dù tỉ lệ cao. Đúng cách Apache POI làm
 * (`ZipSecureFile.MIN_INFLATE_RATIO`: chưa đọc đủ 100 KiB OUTPUT thì chưa
 * xét tỉ lệ) - dùng CHÍNH 100 KiB của POI, không tự đặt số khác: sàn miễn
 * kiểm rộng hơn (ví dụ 1 MB) để lọt một bom CÙNG tỉ lệ nhưng output chỉ
 * ~1.000.000 byte (dưới 1 MB, trên 100 KiB) qua hẳn tầng zip.
 *
 * QUAN TRỌNG khi đọc code: điều kiện miễn kiểm trong `zip-stream-entry.ts`
 * so `byteEntry` (đếm TRONG LÚC giải nén) với hằng số này - KHÔNG so
 * `compData.length` (cỡ nén đầu vào). Bản đầu tiên của phase này lỡ so theo
 * cỡ nén, khiến chốt tỉ lệ trở thành code chết (không đường nào tới được nó
 * trước khi trần MỘT entry đã chặn) - đã sửa và có test riêng.
 */
export const TRAN_MIEN_KIEM_TI_LE = 100 * 1024;

/**
 * Số entry tối đa trong một archive. Corpus OOXML thật đo được trung bình
 * 23,2 entry, cao nhất 99 - headroom 2,6x. Chặn archive vài vạn entry nhỏ
 * (mỗi entry rẻ về byte nhưng tốn CPU duyệt central directory + mở stream).
 */
export const TRAN_SO_ENTRY = 256;

/**
 * Độ sâu lồng thẻ XML tối đa - trần chặn ReDoS/tràn stack của chính bộ đọc
 * SAX. Đo được: chặn input đối kháng 4 MB trong 2,1 ms, không phụ thuộc cỡ
 * input (throw ngay khi vượt, không đợi đọc hết). Tài liệu Word thật hiếm
 * khi lồng quá ~20 cấp.
 */
export const TRAN_DO_SAU_XML = 256;

/**
 * Trần tổng số ký tự trích ra (chữ THẬT đã gom vào kết quả, không phải cỡ
 * XML đầu vào). [ước lượng] - chưa đo trên tài liệu thật lớn nhất người vận
 * hành dự định upload; nên chỉnh theo `KB_MAX_FILE_MB` nếu cần nới/siết.
 * Chặn ca "XML hợp lệ nhưng toàn chữ" mà mọi trần zip/depth ở trên không bắt
 * được (chữ thật thường chỉ chiếm 1-2% cỡ XML, nên trần XML không chặn nổi
 * dạng bom "toàn `<w:t>` hợp lệ, không lồng sâu, chỉ nhiều").
 */
export const TRAN_TONG_KY_TU_TRICH = 8 * 1024 * 1024;

/**
 * Số cột tối đa THẬT của Excel (cột cuối cùng XFD = 16.384) - trần cho chỉ số
 * cột suy ra từ thuộc tính `r=` của `<c>` (`xlsx-sax-sheet-builder.ts`).
 *
 * KHÔNG kẹp trần này thì `r="AAAAAAA1"` (7 chữ cái) quy ra chỉ số cột hơn 321
 * triệu - vòng lặp lấp cột nhảy cóc (`themOVaoDong`) cấp phát một mảng chuỗi
 * hơn 321 triệu phần tử. Đo được: OOM FATAL của V8 (không phải lỗi bắt được
 * bằng try/catch) trên container giới hạn 384 MB old space - nặng hơn cả ReDoS
 * gốc mà phase này đóng, vì ReDoS chỉ khoá event loop còn process SỐNG, còn
 * OOM fatal GIẾT HẲN process (mọi tài khoản Zalo mất kết nối cùng lúc). Entry
 * chứa `r=` độc chỉ cần vài trăm byte - không trần zip/entry/tổng nào ở trên
 * bắt được ca này (xem `xlsx-sax-sheet-builder.ts`).
 */
export const TRAN_SO_COT_EXCEL = 16384;

/**
 * Tổng số Ô (kể cả ô ĐỆM do cột nhảy cóc, không chỉ ô có chữ) được phép xử lý
 * cho CẢ file xlsx - dùng chung một bộ đếm cho MỌI sheet (giống trần tổng
 * giải nén của `zip-stream-entry.ts`: nếu đếm riêng từng sheet thì chia nhỏ
 * đủ số sheet là lách được).
 *
 * Kẹp `TRAN_SO_COT_EXCEL` (16.384) chỉ chặn CẤP PHÁT MỘT Ô, không chặn SỐ
 * HÀNG lặp lại thao tác đó. Đo được: 100.000 hàng, mỗi hàng một `<c
 * r="XFD1".../>` (sheet nén chỉ ~507 KB trên đĩa) khiến vòng lặp lấp cột
 * (`themOVaoDong`) chạy khoảng 1,6 TỈ lần `push` - 21,7 giây khoá event loop,
 * với `--max-old-space-size=384` (đúng ngân sách container). Hàng toàn ô
 * RỖNG không bị `TRAN_TONG_KY_TU_TRICH` bắt (hàng bị `dongHienTai.some(o =>
 * o.trim())` lọc bỏ TRƯỚC khi cộng vào `tongKyTu`) - đây là trần THỨ HAI,
 * đo theo CÔNG CẤP PHÁT chứ không theo CHỮ TRÍCH RA, cho đúng loại chi phí
 * cần chặn. Ngoại suy tới trần entry 32 MB (~730.000 hàng tương tự): ~160
 * giây khoá - cùng cỡ ReDoS gốc (127 giây) mà phase này sinh ra để đóng.
 *
 * 2.000.000 (2 triệu): xấp xỉ số `<c>` THẬT tối đa nhồi vừa MỘT entry 32 MB
 * (mỗi `<c r="A1" s="1"/>` tối thiểu ~15-20 byte -> 32 MB / ~16 byte ≈ 2
 * triệu) - tức trần này không siết thêm gì so với trần entry đã có cho nội
 * dung THẬT, chỉ riêng chặn phần KHUẾCH ĐẠI qua ô đệm (1 ô XFD tự đóng nặng
 * ~20 byte XML nhưng buộc 16.383 lần `push`). Headroom rộng so với dữ liệu
 * thật: "một bảng giá thật không quá vài chục nghìn ô có chữ" (chục nghìn <<
 * 2 triệu). Ở thông lượng đo được (~75 triệu `push`/giây), 2 triệu hoàn tất
 * trong ~30 ms - xa dưới 1 giây.
 */
export const TRAN_TONG_SO_O = 2_000_000;

/**
 * Nguồn thông tin dùng để CHẶN: "khai-bao" đọc thẳng kích thước/số lượng KHAI
 * trong central directory - rẻ (chưa giải nén gì) nhưng có thể bị khai gian.
 * "do-that" đếm TRỰC TIẾP trong lúc giải nén/xử lý - luôn đúng, không thể
 * khai gian né. Export alias để mọi nơi dùng lại (`LoiVuotTran`,
 * `zip-stream-entry.ts`) không chép tay literal union nhiều lần.
 */
export type NguonChanTran = "khai-bao" | "do-that";

/**
 * Ném khi vượt BẤT KỲ trần nào ở trên - đánh dấu để `xml-sax-scan.ts` không
 * vô tình dịch một lỗi ĐÃ tiếng Việt sẵn (từ `zip-stream-entry.ts` hoặc chính
 * state machine docx/xlsx) thành "XML không hợp lệ: ..." chung chung. Trước
 * khi có lớp này, `xml-sax-scan.ts` chỉ nhận diện lỗi trần bằng cách so khớp
 * chuỗi "lồng quá sâu" trong message - mong manh, và các trần KHÁC (tổng ký
 * tự trích ra, cột vượt XFD) không được miễn dịch, bị dán nhãn sai là lỗi cú
 * pháp XML dù file hoàn toàn hợp lệ.
 *
 * `entryName`/`nguon` là trường CHẨN ĐOÁN tuỳ chọn, KHÔNG lộ ra `message`
 * (message giữ ngắn gọn cho người dùng cuối đọc trên dashboard). Đặt trên
 * chính lớp lỗi thay vì `log.warn` ngay tại nơi ném: `zip-stream-entry.ts` là
 * module THUẦN, import tĩnh ở nhiều file test (`extract-docx-text.test.ts`...)
 * - kéo `shared/logger.ts` vào sẽ đọc `DATA_DIR` qua `env.ts` lúc nạp module,
 * đúng bẫy "Bẫy khi viết test" của CLAUDE.md. Đóng gói dữ liệu vào lỗi để
 * CALLER có logger (`kb-ingest-worker.ts`) tự đọc ra mà ghi log, không buộc
 * module thuần phải biết tới logger.
 */
export class LoiVuotTran extends Error {
  readonly entryName?: string;
  readonly nguon?: NguonChanTran;

  constructor(message: string, chiTiet?: { entryName?: string; nguon?: NguonChanTran }) {
    super(message);
    this.name = "LoiVuotTran";
    this.entryName = chiTiet?.entryName;
    this.nguon = chiTiet?.nguon;
  }
}
