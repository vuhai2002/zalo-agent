import { DAU_HIEU_RO_PROMPT } from "../agent/prompt-leak-markers.js";
import { laDongSentinel } from "../scheduler/silent-sentinel.js";
import { MOC_KHOI, tachKhoiCode, traKhoiCodeVe } from "./sanitize-code-block.js";

/**
 * Lớp làm sạch CUỐI CÙNG trước khi chữ của model xuống Zalo - mảnh còn thiếu
 * trong mô hình phân lớp của OpenAI (lọc đầu vào, chống injection, rủi ro tool
 * đều đã có; guardrail ĐẦU RA thì chưa).
 *
 * Trước module này, `result.text` đi thẳng vào `sendReplyInParts`. Persona có
 * DẶN "không markdown", nhưng dặn không phải bảo đảm - và Zalo không render
 * markdown nên `**đậm**` với `## Tiêu đề` hiện ra nguyên ký tự trước mắt người
 * dùng mỗi ngày.
 *
 * Cố ý KHÔNG làm bộ kiểm duyệt nội dung. Đây là bot cá nhân; chỉ chữa ba thứ
 * ĐO ĐƯỢC, không đoán ý.
 *
 * CỐ Ý BỎ QUA `__đậm__` và `_nghiêng_`: dấu gạch dưới sống đầy trong tên file và
 * URL thật (`bao_gia_2026.pdf`), nên bắt chúng là đổi hỏng dữ liệu thật để chữa
 * một dạng markdown model gần như không dùng khi đã được dặn viết lời thường.
 * Cũng bỏ qua `> trích dẫn` và danh sách đánh số - hai thứ đó đọc vẫn tự nhiên
 * trên Zalo.
 *
 * HAI LUẬT SỐNG CÒN của mọi biểu thức trong file này:
 *
 *   1. KHÔNG ĐƯỢC NUỐT CHỮ. Hàm này chạm vào MỌI câu trả lời của bot, nên một
 *      biểu thức ăn tham làm mất nội dung còn tệ hơn nhiều so với việc để lọt
 *      vài ký tự định dạng. Vòng rà soát đầu đã bắt được hai ca nuốt trắng.
 *   2. PHẢI TUYẾN TÍNH. Bot đọc tin của người lạ, mà một tin soạn khéo khiến
 *      model nhại lại chuỗi độc là đủ để biểu thức bậc hai treo cả tiến trình -
 *      process này một luồng phục vụ mọi account, vòng tick scheduler lẫn HTTP
 *      dashboard. Nên MỖI biểu thức chỉ có MỘT lượng từ mở trên cùng một lớp ký
 *      tự; phần kiểm thêm làm bằng code, không bằng backtrack.
 *
 * Module THUẦN: không env, không logger, không DB. `daSua` trả ra ngoài để
 * caller ghi log - sửa chữ của model rồi im lặng là tự bịt mắt mình lúc chẩn
 * đoán.
 */

export type KetQuaLamSach = {
  /** Chữ đã làm sạch. Rỗng khi `chan` - đừng gửi. */
  text: string;
  /** Những thứ đã chỉnh, để log. Rỗng nghĩa là không đụng một ký tự nào. */
  daSua: string[];
  /** Chặn hẳn: câu trả lời rò system prompt, gửi nửa vời còn tệ hơn không gửi. */
  chan: boolean;
};


function boInlineCode(text: string, daSua: string[]): string {
  const sau = text.replace(/`([^`\n]+)`/g, "$1");
  if (sau !== text) daSua.push("inline code");
  return sau;
}

/** `# Tiêu đề` -> `Tiêu đề`. Chỉ ở ĐẦU DÒNG, để `#hashtag` giữa câu không bị đụng. */
function boTieuDe(text: string, daSua: string[]): string {
  const sau = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  if (sau !== text) daSua.push("tiêu đề");
  return sau;
}

/**
 * `[chữ](url)` -> `chữ (url)`. Giữ URL vì đó là thông tin THẬT người dùng cần -
 * bỏ luôn là làm mất nội dung, không phải làm sạch.
 *
 * MỘT lượng từ cho phần trong ngoặc, tách bằng code. Bản đầu dùng
 * `([^)\s]+)[^)]*` - vừa bậc hai (hai lượng từ chồng miền), vừa VỨT TRẮNG phần
 * đuôi vì `[^)]*` không nằm trong nhóm nào.
 *
 * ĐÒI phần trong ngoặc TRÔNG NHƯ một địa chỉ. Cú pháp `[...](...)` xuất hiện
 * đầy trong văn bản thường mà không hề là liên kết, và đổi nó đi là làm hỏng
 * chữ thật:
 *
 *   `Mã lô [A12](hàng nhập) đã về kho`  -> phải giữ NGUYÊN
 *   `Gọi handlers[0](event) là được`    -> phải giữ NGUYÊN
 *
 * Cái giá: liên kết dùng đường dẫn tương đối (`[tài liệu](docs/a.md)`) không
 * được đổi. Chấp nhận - để nguyên thì vẫn đọc được, còn đổi nhầm chữ thật thì
 * không cứu lại được.
 *
 * `![alt](url)` (ảnh) cũng vào đây, dấu `!` bị nuốt cùng.
 */
const DIA_CHI_RE = /^(https?:\/\/|www\.|mailto:|tel:|ftp:\/\/|\/)/i;

/**
 * KẸP TRẦN cho hai lượng từ là bắt buộc, không phải cho gọn.
 *
 * `\[([^\]\n]*)\]` không giới hạn thì mỗi dấu `[` mở đầu một lượt quét tới cuối
 * dòng rồi thất bại - O(n^2) trên chuỗi toàn dấu mở. Đo thật: 51.200 dấu `[`
 * mất 1,26 giây, 102.400 mất 5,8 giây (đủ treo cả tiến trình một luồng này).
 * Kẹp trần biến nó thành O(n * trần).
 *
 * Con số chọn rộng rãi so với thực tế: chữ hiển thị của liên kết dài quá 200 ký
 * tự thì không còn là nhãn, và URL dài quá 500 thì cắt bớt cũng chẳng ai bấm.
 * Vượt trần thì chuỗi giữ NGUYÊN - không đổi còn hơn đổi sai.
 */
const LIEN_KET_RE = /!?\[([^\]\n]{0,200})\]\(([^)\n]{0,500})\)/g;

function boLienKet(text: string, daSua: string[]): string {
  const sau = text.replace(
    LIEN_KET_RE,
    (nguyenVan, chu: string, trong: string) => {
      const noi = trong.trim();
      if (!DIA_CHI_RE.test(noi)) return nguyenVan;
      return chu.trim() ? `${chu} (${noi})` : noi;
    },
  );
  if (sau !== text) daSua.push("liên kết");
  return sau;
}

/**
 * `**đậm**` -> `đậm`. Chạy TRƯỚC phần nghiêng, nếu không thì bộ nghiêng ăn một
 * dấu sao mỗi bên và để lại hai dấu lẻ.
 *
 * Vế `(?<![\w*])` ở dấu MỞ là bắt buộc, cùng lý do với phần nghiêng: thiếu nó
 * thì `2**3**2 = 512` (luỹ thừa Python) ra `232`. Không thêm vế tương ứng ở dấu
 * ĐÓNG để `**Giá**là 45k` vẫn dọn được.
 */
function boDam(text: string, daSua: string[]): string {
  const sau = text.replace(/(?<![\w*])\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "$1");
  if (sau !== text) daSua.push("in đậm");
  return sau;
}

/**
 * `*nghiêng*` -> `nghiêng`.
 *
 * Hai thứ PHẢI giữ nguyên, và đó là lý do biểu thức khó đọc thế này:
 *
 *   - Gạch đầu dòng `-`: persona đang DẠY bot dùng nó để chia ý. Không đụng tới
 *     (biểu thức này chỉ nhìn dấu sao nên vốn đã an toàn).
 *   - Dấu sao giữa từ, kiểu `2*3*4`: phải ra đúng `2*3*4`. Chặn bằng cách đòi
 *     dấu mở KHÔNG đứng ngay sau ký tự chữ/số - đúng luật "left-flanking" của
 *     CommonMark. Thiếu vế này thì `2*3*4` bị đọc thành `2` + nghiêng(`3`) + `4`
 *     và một phép nhân biến thành `234`.
 *
 * Cũng đòi không có khoảng trắng ngay trong cặp: `a * b * c` là phép tính, không
 * phải chữ nghiêng.
 */
function boNghieng(text: string, daSua: string[]): string {
  const sau = text.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1");
  if (sau !== text) daSua.push("in nghiêng");
  return sau;
}

/**
 * Bỏ DÒNG PHÂN CÁCH của bảng markdown (`|---|---:|`).
 *
 * Chỉ bỏ đúng dòng đó, KHÔNG dựng lại cả bảng. Lý do: dòng phân cách là nhiễu
 * thuần túy - không mang một chữ nào - nên bỏ đi là mất trắng; còn các dòng dữ
 * liệu vẫn đọc được dạng "| A | B |", và tự dựng lại bảng thành văn xuôi thì
 * phải đoán đâu là tiêu đề đâu là dữ liệu, đúng kiểu "làm quá" mà phase này
 * tránh.
 *
 * MỘT lượng từ, điều kiện "có ít nhất hai gạch ngang liền nhau" kiểm bằng code.
 * Bản đầu viết `[ \t:|-]*--[ \t:|-]*` - hai lượng từ trên lớp ký tự CÓ CHỨA `-`
 * kẹp giữa là `--`, cho O(n^2): đo thật 25.600 dấu gạch mất 1,4 giây, và model
 * hoàn toàn nhại lại được chuỗi đó nếu người lạ soạn tin bảo nó nhại.
 */
function boDongPhanCachBang(text: string, daSua: string[]): string {
  const sau = text.replace(/^[ \t]*\|[-:| \t]*$\r?\n?/gm, (dong) => (dong.includes("--") ? "" : dong));
  if (sau !== text) daSua.push("dòng kẻ bảng");
  return sau;
}

/**
 * Bỏ THẺ MÀU/GẠCH CHÂN, giữ nguyên nội dung bên trong.
 *
 * Cần ở đây vì đường này là đường khi TẮT cấu hình định dạng: persona vẫn dạy
 * model cú pháp `<cam>...</cam>`, nên thẻ vẫn có thể xuất hiện. Không bóc thì
 * người dùng nhận nguyên chuỗi `<cam>Thời gian:</cam>` - tệ hơn hẳn so với mất
 * màu. Cùng danh sách thẻ với `markdown-inline-styles.ts`.
 *
 * Biểu thức TUYẾN TÍNH nhờ lớp ký tự phủ định `[^<\n]`, cùng luật với cả file.
 */
const THE_MAU_RE = /<\/?(?:do|cam|vang|xanh|gach)>/gi;

function boTheMau(text: string, daSua: string[]): string {
  if (!text.includes("<")) return text;
  const sau = text.replace(THE_MAU_RE, "");
  if (sau !== text) daSua.push("thẻ màu");
  return sau;
}

/**
 * Bỏ dòng CHỈ chứa nhãn `[SILENT]` lọt vào lượt chat THƯỜNG.
 *
 * Dùng `laDongSentinel` (cấp DÒNG), KHÔNG dùng `isSilentResponse` (cấp CẢ CÂU
 * TRẢ LỜI). Bản đầu dùng nhầm hàm cấp câu để lọc từng dòng, mà hàm đó có luật
 * "mở đầu bằng [SILENT] thì nuốt cả câu" - nên "[SILENT] là nhãn nội bộ, dùng
 * để bot im lặng ạ" (câu trả lời hợp lệ khi người dùng hỏi về chính cái nhãn)
 * bị vứt sạch, người nhắn ngồi im không nhận gì.
 */
function boSentinel(text: string, daSua: string[]): string {
  if (!text.includes("[")) return text;
  const dong = text.split(/\r?\n/);

  // Lọc MỘT lần rồi suy ra "có đụng gì không" từ độ dài, thay vì gọi vị từ ở hai
  // chỗ (`some` rồi `filter`). Hai lời gọi là hai chỗ phải sửa cùng lúc, mà đổi
  // lệch một cái thì hành vi phân kỳ âm thầm.
  const giu = dong.filter((d) => !laDongSentinel(d));
  if (giu.length === dong.length) return text;
  daSua.push("nhãn [SILENT]");
  // Bỏ dòng RỖNG ở hai đầu (nhãn đi kèm một dòng trắng là chuyện thường), chứ
  // KHÔNG `.trim()` cả chuỗi - trim cả chuỗi thì ăn luôn khoảng trắng đầu dòng
  // nội dung, mà mọi bước khác trong file này đều không đụng tới khoảng trắng.
  while (giu.length > 0 && giu[0]!.trim() === "") giu.shift();
  while (giu.length > 0 && giu[giu.length - 1]!.trim() === "") giu.pop();
  return giu.join("\n");
}

/** Câu trả lời có mẩu chữ đặc trưng của system prompt không */
export function coDauHieuRoPrompt(text: string): boolean {
  return DAU_HIEU_RO_PROMPT.some((d) => text.includes(d));
}

/**
 * Làm sạch câu trả lời của model trước khi gửi.
 *
 * Kiểm rò prompt trên chữ GỐC, trước khi bỏ định dạng: bỏ trước rồi kiểm thì
 * một dấu hiệu có markdown xen vào (`**Quy tắc an toàn...`) đã bị đổi hình dạng,
 * và bộ canh trượt đúng ca người ta cố tình lách.
 */
export function lamSachTraLoi(text: string): KetQuaLamSach {
  if (coDauHieuRoPrompt(text)) {
    return { text: "", daSua: ["CHẶN: rò system prompt"], chan: true };
  }

  const daSua: string[] = [];

  // Dọn ký tự NUL của model TRƯỚC khi dùng nó làm mốc. Docstring của MOC_KHOI
  // nói "model không sinh ra nó" - đó là giả định, không phải bất biến: JSON
  // escape NUL là hợp lệ. Một chuỗi có dạng NUL + số + NUL sẽ va đúng mốc
  // và `traKhoiCodeVe` nhét nội dung khối code vào nhầm chỗ.
  const sachNul = text.includes(MOC_KHOI) ? text.split(MOC_KHOI).join("") : text;

  // Khối code ra khỏi thân TRƯỚC mọi bước khác, trả về SAU cùng - nội dung bên
  // trong khối là code, không phải văn bản để dọn định dạng
  const { than, khoi } = tachKhoiCode(sachNul, daSua);

  let ra = boInlineCode(than, daSua);
  ra = boLienKet(ra, daSua);
  ra = boTieuDe(ra, daSua);
  ra = boDam(ra, daSua);
  ra = boNghieng(ra, daSua);
  ra = boDongPhanCachBang(ra, daSua);
  ra = boTheMau(ra, daSua);
  ra = boSentinel(ra, daSua);

  return { text: traKhoiCodeVe(ra, khoi), daSua, chan: false };
}

/**
 * Bản làm sạch cho đường GIỮ ĐỊNH DẠNG: chỉ giữ hai lá chắn thật sự là lá chắn,
 * bỏ hết các bước XÓA markdown.
 *
 * Vì sao tách hàm chứ không thêm cờ vào `lamSachTraLoi`: hai đường có tập bước
 * khác hẳn nhau, nhét cờ vào giữa một chuỗi 7 bước là mời gọi nhánh sai lặng lẽ.
 * Đường cũ vẫn còn nguyên và là đường lui khi tắt cấu hình định dạng.
 *
 * Bước XÓA markdown chuyển hết sang `markdownSangStyleZalo` - ở đó dấu markdown
 * không bị vứt mà được DỊCH thành `Style` của Zalo. Riêng khối code thì bộ dịch
 * tự bảo vệ (giữ nguyên xi từng dòng), nên không cần `tachKhoiCode` ở đây nữa.
 */
export function lamSachGiuDinhDang(text: string): KetQuaLamSach {
  // Kiểm rò prompt trên chữ GỐC - cùng lý do đã ghi ở `lamSachTraLoi`
  if (coDauHieuRoPrompt(text)) {
    return { text: "", daSua: ["CHẶN: rò system prompt"], chan: true };
  }

  const daSua: string[] = [];
  // NUL không phải markdown, là rác - không có lý do gì gửi nó lên Zalo
  const sachNul = text.includes(MOC_KHOI) ? text.split(MOC_KHOI).join("") : text;
  return { text: boSentinel(sachNul, daSua), daSua, chan: false };
}
