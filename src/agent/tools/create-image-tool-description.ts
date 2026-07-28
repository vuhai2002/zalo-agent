/**
 * Mô tả tool vẽ ảnh - tách riêng vì đây là thứ dễ viết hỏng nhất.
 *
 * BÀI HỌC ĐẮT: đã từng nhét vào đây một "brief thiết kế 5 mục" kèm ví dụ cụ thể
 * (chữ bên trái, minh họa bên phải, nền navy chuyển tím than, điểm nhấn cyan).
 * Kết quả là MỌI ảnh ra một khuôn, và còn xấu hơn trước.
 *
 * Lý do: `cx/gpt-5.5-image` KHÔNG phải model vẽ ảnh. Router bóc đuôi `-image`
 * rồi gọi thẳng GPT-5.5 - model chat đầy đủ - với `instructions: ""` và một tool
 * `image_generation` (xem `imageProviders/codex.js`, hàm buildBody). Nó đọc
 * prompt như tin nhắn người dùng rồi TỰ thiết kế.
 *
 * Đo thật: gửi prompt trần trụi (đúng câu người dùng gõ, không gợi ý gì) 3 lần
 * cho ra 3 thiết kế khác hẳn nhau, đều dày dặn chuyên nghiệp, và nó tự nghĩ
 * thêm cụm icon kèm chữ tiếng Việt mà không ai bảo. Brief của mình chỉ trói tay
 * nó lại.
 *
 * Nguyên tắc từ đó: mô tả này chỉ nói những gì có LÝ DO CHỨC NĂNG (chữ phải
 * nguyên văn, tỉ lệ phải nói trong prompt vì không có tham số riêng). TUYỆT ĐỐI
 * không kê đơn thẩm mỹ - không ví dụ màu, không ví dụ bố cục, không mật độ.
 * Gu của người viết code lọt vào đây là mọi ảnh của mọi người dùng đều dính.
 */

/** Có lý do chức năng: không chép nguyên văn thì model vẽ ra chữ bịa */
const CHU_PHAI_NGUYEN_VAN =
  "CHỮ NGƯỜI DÙNG ĐƯA phải chép NGUYÊN VĂN vào prompt (tiêu đề, bài viết, câu trích, giá, tên, số điện thoại): " +
  'đặt trong ngoặc kép, ghi rõ vai trò từng phần (TIÊU ĐỀ: "...", ĐOẠN MỞ: "...", TRÍCH DẪN: "..."). ' +
  'TUYỆT ĐỐI không tóm tắt thành chủ đề - viết "chủ đề thiền Phật giáo" thì ảnh ra chữ bịa, còn chép nguyên ' +
  "văn thì ra đúng chữ họ cần. Giữ nguyên dấu tiếng Việt, dặn viết đúng chính tả.";

/** Có lý do chức năng: API không có tham số kích thước, model bỏ qua `size` */
const TI_LE_NOI_TRONG_PROMPT =
  "KÍCH THƯỚC/TỈ LỆ không có tham số riêng - muốn dọc, ngang, vuông hay tỉ lệ cụ thể (4:1, 16:9...) thì phải " +
  "nói trong prompt.";

/**
 * Điều quan trọng nhất: chuyển đúng ý người dùng, KHÔNG tự thêm ràng buộc.
 * Bên nhận prompt là một model chat biết thiết kế - để nó tự do thì mỗi lần ra
 * một phương án khác; áp sẵn phong cách là mọi ảnh giống nhau.
 */
const TRUNG_THANH_VOI_Y_NGUOI_DUNG =
  "Prompt phải TRUNG THÀNH với ý người dùng. Họ nói gì về phong cách (sang trọng, tối giản, rực rỡ, cổ điển, " +
  "trẻ trung...), màu sắc, bố cục, thứ muốn có trong ảnh thì đưa hết vào. Họ KHÔNG nói thì ĐỪNG TỰ BỊA ràng " +
  "buộc - đừng tự chọn màu, đừng tự sắp bố cục, đừng tự quyết dày hay thoáng. Bên nhận prompt là một model " +
  "biết thiết kế, để nó tự do thì mỗi lần ra một phương án khác nhau; áp sẵn phong cách là ảnh nào cũng như " +
  "ảnh nào. Mô tả ngắn gọn đúng thứ người dùng cần còn hơn tả dài theo gu của bạn.";

/** Người dùng chê xấu: phải hỏi/đoán đúng hướng họ muốn, không lặp lại prompt cũ */
const KHI_BI_CHE_XAU =
  "Người dùng chê xấu hoặc nhờ chỉnh lại: viết prompt MỚI theo ĐÚNG hướng họ nêu (sang trọng hơn, tối giản hơn, " +
  "nhiều màu hơn...), giữ nguyên phần chữ. Đừng gửi lại prompt cũ, cũng đừng tự đổi sang hướng họ không nhắc tới.";

export const CREATE_IMAGE_DESCRIPTION =
  "Vẽ ảnh mới bằng AI hoặc SỬA ảnh người dùng vừa gửi, rồi gửi thẳng vào cuộc trò chuyện. " +
  "Dùng khi người dùng nhờ vẽ/tạo/thiết kế ảnh (poster, banner, cover, e-magazine, minh họa), " +
  "hoặc nhờ sửa ảnh họ gửi (đổi màu, xóa vật thể, đổi phong cách).\n" +
  "Mất 1-3 phút mỗi ảnh nên chỉ gọi khi người dùng thật sự muốn có ảnh.\n" +
  `${CHU_PHAI_NGUYEN_VAN}\n` +
  `${TI_LE_NOI_TRONG_PROMPT}\n` +
  `${TRUNG_THANH_VOI_Y_NGUOI_DUNG}\n` +
  `${KHI_BI_CHE_XAU}`;
