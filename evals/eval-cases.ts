import type { EvalCase } from "./eval-case-type.js";

/**
 * Bộ case eval chạy MODEL THẬT.
 *
 * Gộp một file thay vì mỗi case một file như bản kế hoạch phác: mỗi case chỉ
 * khoảng 15 dòng, tách ra 5 file là vụn vặt mà chẳng dễ đọc hơn. Tách khi file
 * này vượt 200 dòng.
 *
 * TẮT TOOL ĐẮT TIỀN theo từng case (`create_image`, `create_word_document`,
 * `create_excel_file`) ở những case không cần chúng. Hai lý do, lý do thứ hai
 * mới là chính:
 *
 *   - Tiền: một lần gọi vẽ ảnh là tiền thật và 60-135 giây chờ.
 *   - ĐỘ ĐÚNG của phép đo: case "định dạng" hỏi "lập bảng so sánh" mà để
 *     `create_excel_file` bật thì model rất có thể đi tạo file Excel và trả về
 *     một câu ngắn "đã gửi file" - lúc đó khẳng định "text cuối không còn
 *     markdown" xanh mà chẳng đo được gì.
 */

export const EVAL_CASES: EvalCase[] = [
  {
    ten: "gio-chinh-xac",
    lyDo:
      "System prompt CỐ Ý chỉ ghi ngày + thứ, KHÔNG ghi giờ (giờ đổi mỗi phút thì vỡ prompt cache " +
      "mỗi phút - xem currentDateLine). Nên hỏi giờ là thứ model KHÔNG thể tự biết, buộc phải gọi " +
      "get_datetime. Đoán giờ là sai chắc chắn, mà nói ra vẫn nghe rất tự tin.\n" +
      "Bản đầu của case này hỏi 'hôm nay thứ mấy' và đòi gọi get_datetime - SAI: ngày đã nằm sẵn " +
      "trong prompt, gọi tool là thừa, đúng thứ mà case khong-tra-thua phạt. Chính lần chạy thật " +
      "bắt được mâu thuẫn đó.",
    tinNhan: "bây giờ mấy giờ rồi bạn?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      goiTool: ["get_datetime"],
    },
  },

  {
    ten: "ngay-co-san",
    lyDo:
      "Mặt trái của case trên, và là hàng rào cho một tối ưu dễ bị bỏ quên: dòng ngày trong system " +
      "prompt tồn tại ĐỂ model khỏi phải gọi tool. Nếu model vẫn gọi get_datetime cho câu hỏi ngày " +
      "thì dòng đó vô dụng mà vẫn tốn token mỗi lượt - lúc đó phải xem lại cách diễn đạt của nó.",
    tinNhan: "hôm nay thứ mấy vậy bạn?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["get_datetime", "web_search"],
      kiemTraText: {
        moTa: "phải trả lời được bằng chữ, không im lặng",
        dat: (t) => t.trim().length >= 5,
      },
    },
  },

  {
    ten: "tra-cuu",
    lyDo:
      "Câu hỏi về số liệu thay đổi hàng ngày. Model KHÔNG được trả lời bằng trí nhớ huấn luyện - " +
      "giá vàng trong đầu model là giá của năm ngoái, mà nói ra vẫn nghe rất tự tin.",
    tinNhan: "giá vàng SJC hôm nay bao nhiêu vậy?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      goiTool: ["web_search"],
    },
  },

  {
    ten: "khong-tra-thua",
    lyDo:
      "Chiều ngược lại của hai case trên. Chỉ thưởng cho việc gọi tool thì model học cách gọi tool " +
      "với MỌI tin nhắn - tốn token, chậm, và một lời chào thành ba lượt gọi mạng.",
    tinNhan: "chào bạn nhé",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: [
        "get_datetime",
        "web_search",
        "web_fetch",
        "read_image",
        "get_group_info",
        "save_memory",
        "schedule_task",
        "send_file",
      ],
    },
  },

  {
    ten: "cong-cu-hep",
    lyDo:
      "Kiểm chứng lớp tắt tool theo agent (phase 02) ở tầng HÀNH VI, không chỉ tầng schema. " +
      "Tool bị tắt thì model không những không gọi được, mà còn phải NÓI THẬT là không làm được - " +
      "persona có dặn 'không hứa việc cần công cụ ngoài danh sách'. Hứa lèo rồi im là kết cục tệ nhất.",
    tinNhan: "vẽ giúp mình con mèo đang ngủ nhé",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["create_image"],
      kiemTraText: {
        moTa: "phải trả lời bằng chữ (nói thật là không vẽ được), không im lặng",
        dat: (t) => t.trim().length >= 10,
      },
    },
  },

  // Ba case dưới đây là HÀNG RÀO HỒI QUY, không phải bằng chứng cho ba dòng
  // "hỏi lại" trong BASE_PERSONA.
  //
  // Đã đo thật: bỏ hẳn ba dòng đó khỏi persona rồi chạy lại, cả ba case VẪN
  // XANH - kể cả ca khó hơn ("đặt lịch nhắc mình uống thuốc buổi sáng", có nội
  // dung nhưng giờ mơ hồ). Model đang dùng (gpt-combo) tự biết hỏi lại mà không
  // cần dặn. Nói cách khác: ba dòng đó KHÔNG chứng minh được là có tác dụng với
  // model này.
  //
  // Vẫn giữ cả ba case, vì thứ chúng canh là HÀNH VI CỦA CẢ HỆ THỐNG chứ không
  // phải công của ba dòng: đổi sang model rẻ hơn, hay ai đó sửa persona theo
  // hướng giục model làm cho nhanh, thì đây là chỗ đỏ trước khi người dùng nhận
  // một file Excel rỗng.
  {
    ten: "hoi-lai-khi-thieu",
    lyDo:
      "12-Factor #7 'Contact Humans with Tool Calls': agent CHỦ ĐỘNG hỏi khi thiếu thông tin. " +
      "Tạo file rỗng rồi mới biết sai là tốn công cả hai bên - người dùng phải nói lại từ đầu, " +
      "mà bot đã kịp gửi một file vô nghĩa vào cuộc trò chuyện.",
    tinNhan: "tạo file Excel giúp mình với",
    // create_excel_file để BẬT ở case này - phải đo được là model KIỀM CHẾ
    // không gọi nó, chứ tắt đi thì nó có muốn gọi cũng không gọi được.
    //
    // KHÔNG đòi câu trả lời có dấu hỏi, dù bản đầu có đòi. Lần chạy thật cho ra
    // câu này: "Bạn gửi mình toàn bộ thông tin trong một lần để mình làm đúng
    // ngay:" rồi liệt kê gạch đầu dòng - gom đúng ý, không tạo file bừa, chỉ là
    // viết ở thể mệnh lệnh nên không có dấu hỏi nào. Đòi dấu hỏi là khẳng định
    // trên CÁCH DIỄN ĐẠT, đúng thứ mà bộ eval này cấm; và sửa persona cho nó
    // luôn kết thúc bằng dấu hỏi là làm câu trả lời tệ đi để chiều một phép đo
    // sai. Bất biến thật nằm ở `khongGoiTool`: thiếu thông tin thì KHÔNG làm bừa.
    disabledTools: ["create_image", "create_word_document"],
    mongDoi: {
      khongGoiTool: ["create_excel_file"],
      kiemTraText: {
        moTa: "phải trả lời bằng chữ để xin thông tin, không im lặng",
        dat: (t) => t.trim().length >= 30,
      },
    },
  },

  {
    ten: "khong-hoi-van",
    lyDo:
      "Mặt trái của case trên, và là hàng rào cho rủi ro lớn nhất của luật hỏi lại: luật quá " +
      "rộng thì bot hỏi vặn cả câu hỏi kiến thức thường - tệ hơn hẳn so với cứ trả lời thẳng. " +
      "Dòng thứ hai trong persona ('đừng hỏi vặn') sinh ra để chặn, case này canh nó.",
    tinNhan: "thủ đô nước Pháp là gì vậy?",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["web_search", "web_fetch"],
      kiemTraText: {
        moTa: "trả lời thẳng, KHÔNG kết thúc bằng câu hỏi ngược lại",
        // Chỉ xét dấu hỏi ở CUỐI: bot hoàn toàn có thể nhắc lại câu hỏi của
        // người dùng ở giữa câu trả lời, đó không phải hỏi vặn
        dat: (t) => !t.trim().endsWith("?"),
      },
    },
  },

  {
    ten: "hoi-gop-mot-lan",
    lyDo:
      "Vai thứ ba của luật hỏi lại: gom hết thứ còn thiếu vào MỘT câu. Hỏi lắt nhắt qua nhiều " +
      "lượt trên Zalo là cực kỳ khó chịu - mỗi lượt là một tin nhắn, người dùng phải trả lời " +
      "ba lần cho một việc.",
    tinNhan: "đặt lịch nhắc mình nhé",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      khongGoiTool: ["schedule_task"],
      kiemTraText: {
        moTa: "xin thông tin trong MỘT tin, không rải quá 2 câu hỏi",
        // Chỉ đặt TRẦN TRÊN, không đòi phải có dấu hỏi - cùng lý do với case
        // hoi-lai-khi-thieu: model gom đúng ý nhưng viết ở thể mệnh lệnh là
        // hoàn toàn hợp lệ. Ba dấu hỏi trở lên mới thật sự là hỏi lắt nhắt.
        dat: (t) => t.trim().length >= 20 && (t.match(/\?/g) ?? []).length <= 2,
      },
    },
  },

  {
    ten: "dinh-dang",
    lyDo:
      "Yêu cầu 'lập bảng' là cái bẫy markdown tự nhiên nhất - model được huấn luyện để trả về bảng " +
      "markdown. Zalo không render markdown nên nó hiện ra nguyên ký tự. Đây là phép thử ĐẦU-CUỐI " +
      "cho lớp làm sạch của phase 06, khác với test đơn vị vốn tự dựng chuỗi đầu vào.",
    tinNhan: "lập bảng so sánh 3 loại cà phê: đen, sữa, bạc xỉu - giá và độ đậm",
    disabledTools: ["create_image", "create_word_document", "create_excel_file"],
    mongDoi: {
      kiemTraText: {
        moTa: "không còn ký tự định dạng markdown (**, ##, ```)",
        dat: (t) => !t.includes("**") && !/^\s*#{1,6}\s/m.test(t) && !t.includes("```"),
      },
    },
  },
];
