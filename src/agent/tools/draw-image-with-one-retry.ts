import { laLoiVeHutAnh } from "../../images/image-retry-policy.js";
import type { GeneratedImage, GenerateImageParams } from "../../images/image-generation-client.js";

/**
 * Gọi provider vẽ ảnh, hụt thì BÁO CHO NGƯỜI DÙNG rồi thử lại đúng MỘT lần.
 *
 * Vì sao đúng một lần: lỗi "chạy xong mà không ra ảnh" là hành vi không xác
 * định của model upstream (xem `image-retry-policy.ts`), đo thật thì gọi lại
 * gần như chắc được - 9/9. Thử lại lần hai gần như chỉ để kéo dài thời gian
 * chờ: mỗi lần vẽ tốn 1-3 phút, ba lần là người ta bỏ đi rồi mới có ảnh.
 *
 * Vì sao PHẢI báo trước khi thử lại: người dùng đã nghe hứa "đợi 1-3 phút" ở
 * đầu lượt, mà lần hỏng đo được đã ngốn 129,9 giây. Thử lại âm thầm là để họ
 * ngồi im gần 4 phút sau một lời hứa 3 phút - đúng kiểu im lặng mà câu báo
 * trước ở `create-image-tool.ts` được viết ra để tránh.
 *
 * `baoThuLai` hỏng KHÔNG được làm chết lượt vẽ: gửi được ảnh vẫn quý hơn gửi
 * được lời nhắn. Cùng cách xử lý với câu báo trước ở tool.
 *
 * Tách khỏi `create-image-tool.ts` để test được nhánh thử lại mà không phải
 * dựng cả ToolContext, và để tool khỏi vượt trần 200 dòng.
 */
export async function veVoiMotLanThuLai(
  generate: (params: GenerateImageParams) => Promise<GeneratedImage>,
  params: GenerateImageParams,
  baoThuLai: () => Promise<void> | void,
): Promise<GeneratedImage> {
  try {
    return await generate(params);
  } catch (err) {
    // Mọi lỗi khác đi thẳng ra ngoài: quá hạn, sai key, hết quota thì gọi lại
    // chỉ tốn thêm thời gian chứ không đổi kết cục.
    if (!laLoiVeHutAnh(err)) throw err;

    try {
      await baoThuLai();
    } catch {
      // Nhắn hụt thì thôi, vẫn vẽ tiếp
    }

    // Lần hai hỏng thì để lỗi bay ra - tool bên ngoài lo phần nói thật
    return await generate(params);
  }
}
