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
 * Entry nén ra dưới ngưỡng này (theo kích thước NÉN, tức `compSize` khai
 * trong central directory) được MIỄN kiểm tỉ lệ - entry nhỏ nhiễu mạnh
 * (metadata, docProps...) và không đe doạ gì dù tỉ lệ cao.
 */
export const TRAN_MIEN_KIEM_TI_LE = 1 * 1024 * 1024;

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
