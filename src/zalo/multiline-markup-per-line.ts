/**
 * Rải dấu định dạng VẮT NHIỀU DÒNG thành dấu của từng dòng.
 *
 * VÌ SAO CÓ FILE NÀY - đo trên tin thật ngày 2026-08-05. Model viết thư mời như
 * người ta viết thật, tức là bọc cả khối nhiều dòng trong MỘT cặp dấu:
 *
 *     <cam>**THƯ MỜI THAM GIA
 *     KHÓA THIỀN TỪ TÂN THÁNG 8**</cam>
 *
 *     <xanh>*Tháng Tám chớm thu gió dịu hiền,*
 *     *Lời hẹn khóa thiền giữ vẹn nguyên.*</xanh>
 *
 * `markdown-to-zalo-styles.ts` xử lý TỪNG DÒNG và mọi biểu thức inline đều kẹp
 * bằng lớp phủ định có `\n`, nên cặp dấu vắt dòng KHÔNG BAO GIỜ khớp - người
 * dùng nhận nguyên chuỗi `<xanh>` và `</xanh>` giữa bài.
 *
 * Cách chữa: rải lại thành mỗi dòng một cặp dấu, TRƯỚC khi cắt dòng. Rải chứ
 * không phải cho biểu thức vượt dòng, vì span phủ qua ký tự xuống dòng là thứ
 * đã trả giá ở `lst_1` (Zalo Web và điện thoại render khác nhau). Mỗi dòng một
 * span thì hai client chắc chắn giống nhau.
 *
 * QUÉT BẰNG `indexOf`, KHÔNG dùng biểu thức lười vượt dòng: `([\s\S]*?)` với
 * nhiều thẻ mở mà thiếu thẻ đóng cho ra bậc hai, mà bot đọc tin của người lạ.
 *
 * Module THUẦN: 0 import.
 */

/** Tên thẻ màu/gạch chân - PHẢI khớp danh sách ở `markdown-inline-styles.ts` */
const TEN_THE = ["do", "cam", "vang", "xanh", "gach"] as const;
const THE_MO_RE = new RegExp(`<(${TEN_THE.join("|")})>`, "gi");

/** Bọc lại từng dòng, bỏ qua dòng trống (bọc dòng trống là đẻ ra span rỗng) */
function raiTungDong(noiDung: string, mo: string, dong: string): string {
  return noiDung
    .split("\n")
    .map((d) => (d.trim() === "" ? d : `${mo}${d.trimEnd()}${dong}`))
    .join("\n");
}

/**
 * `**đậm vắt\nhai dòng**` -> `**đậm vắt**\n**hai dòng**`.
 *
 * Chỉ đụng cặp có ký tự xuống dòng ở giữa; cặp trong một dòng để nguyên cho
 * `apDungInline` lo. Bỏ qua khi nội dung dính thêm dấu sao ở hai đầu (`***`) -
 * đó là ca hiếm mà rải sai thì hỏng chữ.
 */
function raiDamNhieuDong(src: string): string {
  if (!src.includes("**")) return src;
  let ra = "";
  let i = 0;
  for (;;) {
    const mo = src.indexOf("**", i);
    if (mo < 0) {
      ra += src.slice(i);
      return ra;
    }
    const dong = src.indexOf("**", mo + 2);
    if (dong < 0) {
      ra += src.slice(i);
      return ra;
    }
    const noiDung = src.slice(mo + 2, dong);
    ra += src.slice(i, mo);
    const raiDuoc = noiDung.includes("\n") && !noiDung.startsWith("*") && !noiDung.endsWith("*");
    ra += raiDuoc ? raiTungDong(noiDung, "**", "**") : `**${noiDung}**`;
    i = dong + 2;
  }
}

/**
 * `<xanh>dòng một\ndòng hai</xanh>` -> `<xanh>dòng một</xanh>\n<xanh>dòng hai</xanh>`.
 *
 * Thẻ không có thẻ đóng thì GIỮ NGUYÊN chữ - cùng luật với cả lớp định dạng:
 * để lọt vài ký tự thẻ còn hơn nuốt chữ của người ta.
 */
function raiTheNhieuDong(src: string): string {
  if (!src.includes("<")) return src;
  let ra = "";
  let i = 0;
  THE_MO_RE.lastIndex = 0;
  for (;;) {
    THE_MO_RE.lastIndex = i;
    const khop = THE_MO_RE.exec(src);
    if (!khop) {
      ra += src.slice(i);
      return ra;
    }
    const ten = khop[1]!.toLowerCase();
    const dauND = khop.index + khop[0].length;
    const theDong = `</${ten}>`;
    // `toLowerCase` cho cả chuỗi con để bắt được `</CAM>` viết hoa
    const conLai = src.slice(dauND).toLowerCase();
    const lech = conLai.indexOf(theDong);
    if (lech < 0) {
      // Thẻ mở không có thẻ đóng - giữ nguyên rồi đi tiếp từ SAU nó
      ra += src.slice(i, dauND);
      i = dauND;
      continue;
    }
    const ketThuc = dauND + lech;
    const noiDung = src.slice(dauND, ketThuc);
    ra += src.slice(i, khop.index);
    ra += noiDung.includes("\n")
      ? raiTungDong(noiDung, `<${ten}>`, `</${ten}>`)
      : `<${ten}>${noiDung}</${ten}>`;
    i = ketThuc + theDong.length;
  }
}

/**
 * Rải mọi dấu vắt dòng. Thứ tự QUAN TRỌNG: `**` trước thẻ.
 *
 * Với `<cam>**A\nB**</cam>` mà rải thẻ trước thì ra `<cam>**A</cam>` - dấu sao
 * mất vế đóng trên dòng đó và lọt ra thành chữ. Rải `**` trước thì thành
 * `<cam>**A**\n**B**</cam>`, rồi rải thẻ mới ra hai dòng cân đối.
 */
export function raiDinhDangNhieuDong(src: string): string {
  return raiTheNhieuDong(raiDamNhieuDong(src));
}
