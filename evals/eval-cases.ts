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
