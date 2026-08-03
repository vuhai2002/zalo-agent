/**
 * Luật dùng tool trong system prompt, CHỈ ghép khi tool tương ứng đang bật.
 *
 * Trước đây mọi luật nằm cứng trong BASE_PERSONA: tắt "Vẽ ảnh AI" trên dashboard
 * thì mục "Khả năng" biến mất đúng tool đó, nhưng bốn dòng dạy cách viết prompt
 * vẽ ảnh vẫn đi kèm mọi lượt - đo được 1163 ký tự dạy luật của tool đã tắt.
 * Vừa tốn token vừa mâu thuẫn: prompt bảo bot đừng hứa việc ngoài danh sách,
 * rồi lại dạy nó cách làm đúng việc đó.
 *
 * Cách làm lấy từ `hermes-agent/agent/system_prompt.py` ("Tool-aware behavioral
 * guidance: only inject when the tools are loaded"): chữ luật để ở module prompt
 * riêng, gate bằng tên tool lúc ghép. Không gắn vào `tool-registry.ts` vì
 * registry còn phục vụ API dashboard - đẩy chữ prompt sang trình duyệt là thừa.
 *
 * Đổi tên tool trong registry mà quên sửa đây thì test `persona-tool-rules.test.ts`
 * đỏ ngay, không âm thầm mất luật.
 */

export type PersonaRule = {
  /**
   * Luật hiện khi CÓ ÍT NHẤT MỘT tool trong danh sách đang bật. Mảng rỗng =
   * luật chung cho việc dùng tool, hiện khi account còn bất kỳ tool nào (theo
   * đúng cách Hermes gate `PARALLEL_TOOL_CALL_GUIDANCE` bằng `valid_tool_names`).
   */
  tools: string[];
  text: string;
};

/** Luật gắn với tool cụ thể - xếp cùng nhóm "Quy tắc trả lời" của persona nền */
const RULES_TRA_LOI: PersonaRule[] = [
  {
    tools: ["add_reaction", "send_file", "tag_member"],
    text: '- Tool hành động (thả reaction, gửi file, tag thành viên) chỉ dùng khi thực sự phục vụ yêu cầu - không lạm dụng.',
  },
  {
    tools: ["create_word_document", "create_excel_file"],
    text: "- Xuất file (create_word_document / create_excel_file) chỉ khi người dùng yêu cầu file, hoặc nội dung là bảng số liệu dài đọc trong chat sẽ rối. Bảng số liệu ưu tiên Excel, văn bản/báo cáo thì Word. Hai tool này TỰ GỬI file rồi - đừng gọi send_file để gửi lại.",
  },
  {
    tools: ["create_image"],
    text: "- Vẽ ảnh (create_image) chỉ khi người dùng thật sự muốn có ẢNH: nhờ vẽ/tạo/thiết kế/làm poster, banner, e-magazine. Mất 1-3 phút mỗi ảnh nên đừng vẽ khi họ chỉ hỏi thông tin. Tool này TỰ GỬI ảnh rồi.",
  },
  {
    tools: ["create_image"],
    text: "- Prompt vẽ ảnh TRUNG THÀNH với ý người dùng: họ nói gì về phong cách, màu, bố cục thì đưa hết vào; họ không nói thì ĐỪNG TỰ BỊA ràng buộc. Bên nhận prompt là model biết thiết kế, để nó tự do thì mỗi lần ra một phương án khác nhau.",
  },
  {
    tools: ["create_image"],
    text: '- Người dùng gửi kèm ĐOẠN CHỮ để đưa vào ảnh (bài viết, tiêu đề, câu trích, bảng giá): CHÉP NGUYÊN VĂN vào prompt, đặt trong ngoặc kép, ghi rõ vai trò từng phần. Tóm tắt thành "chủ đề X" là hỏng - model vẽ ra chữ bịa thay vì chữ họ đưa. Giữ nguyên dấu tiếng Việt.',
  },
  {
    tools: ["create_image"],
    text: '- Tham số mode của create_image: "ve_moi" cho hầu hết yêu cầu (poster, banner, e-magazine, minh họa - dù mô tả dài và chi tiết tới đâu). Chỉ dùng "sua_anh_da_gui" khi người dùng ĐÃ GỬI ẢNH trong hội thoại và nhờ sửa chính tấm đó.',
  },
  {
    tools: ["schedule_task"],
    text: '- Đặt/sửa lịch hẹn (schedule_task) xong: đọc lại mốc giờ tool vừa trả bằng lời cho người dùng nghe để họ xác nhận đúng ý (vd "15:00 ngày 01/08") - đọc lại là cách rẻ nhất để bắt lỗi hiểu sai giờ. Muốn hủy hoặc sửa lịch: LUÔN action=\'list\' trước để lấy đúng id, TUYỆT ĐỐI không tự đoán id.',
  },
];

/**
 * Khối "kể tiến trình" - vô nghĩa khi account không còn tool nào: nó dạy cách
 * dẫn chuyện GIỮA các lần gọi tool, mà không có tool thì không có bước giữa.
 */
const KHOI_KE_TIEN_TRINH = `Quy tắc kể tiến trình (để chủ bot xem lại cách bạn làm việc):
- TRƯỚC mỗi lần gọi tool, viết một câu ngắn nói bạn sắp làm gì và vì sao (vd "Cần giá vàng hôm nay - tra web trước.").
- Bước sau khi tool trả về: mở đầu bằng một câu nhận xét dữ liệu đủ chưa, thiếu gì, bước kế là gì (vd "Đủ 2 nguồn khớp nhau - giờ đối chiếu và trả lời.").
- Mấy câu tiến trình này nằm ở các bước GIỮA nên người dùng không thấy; riêng câu TRẢ LỜI CHỐT gửi cho người dùng thì TUYỆT ĐỐI không kèm chúng. Câu hỏi không cần tool thì trả lời thẳng, không kể tiến trình.`;

/** Khối tra cứu - từng dòng gate riêng vì có dòng chỉ đúng khi có tool web */
const RULES_TRA_CUU: PersonaRule[] = [
  {
    tools: ["web_search"],
    text: '- Thông tin thay đổi theo thời gian hoặc mới hơn dữ liệu huấn luyện (giá cả, tỷ giá, tỷ số, tin tức, lịch chiếu, thông tin sản phẩm, kết quả vừa công bố...) -> BẮT BUỘC dùng web_search trước. Không trả lời từ trí nhớ, không nói "mình không xem được" khi chưa thử tool.',
  },
  {
    tools: ["web_search", "web_fetch"],
    text: "- web_search cho danh sách trang; cần dữ liệu chi tiết thì web_fetch trang cụ thể. Trang đầu không có thứ cần tìm -> thử 1-2 trang khác trong kết quả hoặc đổi từ khóa, rồi mới được kết luận là không tìm thấy.",
  },
  {
    tools: [],
    text: "- Cần nhiều thứ KHÔNG phụ thuộc nhau thì gọi tool cùng lúc trong một lượt (vd đọc 2-3 trang khác nhau), đừng gọi lần lượt từng cái. Mỗi lượt gọi tool phải gửi lại toàn bộ hội thoại nên gọi rời rạc tốn gấp nhiều lần. Chỉ làm tuần tự khi bước sau cần kết quả của bước trước.",
  },
  {
    tools: [],
    text: "- Chỉ hỏi ngược lại người dùng khi thông tin KHÔNG THỂ lấy được bằng tool (vd cần ảnh chụp rõ hơn, thông tin cá nhân của họ).",
  },
  {
    tools: [],
    text: "- Lịch sử chat có thể chứa lượt trước bạn tra không ra - đó là chuyện cũ, có thể do lỗi đã được sửa. Lượt mới LUÔN thử tool lại từ đầu; không lặp lại câu trả lời thất bại cũ trong lịch sử.",
  },
  {
    tools: [],
    text: "- Tool lỗi hay không ra kết quả: nói thật đã tìm ở đâu, TUYỆT ĐỐI không bịa số liệu. Việc dính đến tiền (báo giá, tỷ giá, số liệu tài chính) phải nêu nguồn và ngày của dữ liệu; tra cứu theo kỳ hay theo đợt phải đối chiếu đúng kỳ và đúng ngày người dùng hỏi, không lấy kỳ gần nhất rồi coi là xong.",
  },
];

/** Mọi key tool xuất hiện trong luật - test đối chiếu với registry để bắt đổi tên */
export const TOOL_KEYS_IN_RULES = [
  ...new Set([...RULES_TRA_LOI, ...RULES_TRA_CUU].flatMap((r) => r.tools)),
];

const hopLe = (rule: PersonaRule, available: Set<string>): boolean =>
  rule.tools.length === 0 ? available.size > 0 : rule.tools.some((t) => available.has(t));

/**
 * Các khối luật ăn theo tool, đã lọc theo bộ tool account THỰC SỰ nhận được.
 * Trả về mảng section để `buildSystemPrompt` nối vào đúng chỗ nó muốn.
 */
export function toolPersonaSections(availableToolKeys: string[]): string[] {
  const available = new Set(availableToolKeys);
  const sections: string[] = [];

  const traLoi = RULES_TRA_LOI.filter((r) => hopLe(r, available)).map((r) => r.text);
  if (traLoi.length > 0) sections.push(`Quy tắc dùng công cụ:\n${traLoi.join("\n")}`);

  if (available.size > 0) sections.push(KHOI_KE_TIEN_TRINH);

  const traCuu = RULES_TRA_CUU.filter((r) => hopLe(r, available)).map((r) => r.text);
  if (traCuu.length > 0) {
    sections.push(`Quy tắc tra cứu thông tin (làm đúng thứ tự, đừng bỏ cuộc sớm):\n${traCuu.join("\n")}`);
  }

  return sections;
}
