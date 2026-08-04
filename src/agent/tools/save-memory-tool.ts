import { tool } from "ai";
import { z } from "zod";
import {
  suaFactTheoDoanChu,
  xoaFactTheoDoanChu,
  type KetQuaSuaFact,
  type PhamViSuaFact,
} from "../../conversation/memory-edit-store.js";
import { saveMemoryFact } from "../../conversation/memory-store.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";

/**
 * Memory lớp 3 (tương đương tool `bio` của ChatGPT): agent tự quyết lưu fact
 * đáng nhớ lâu dài. Fact ghi kèm ngữ cảnh học được (DM hay group) để lớp inject
 * áp quy tắc bất đối xứng: fact học ở DM không bao giờ xuất hiện trong group.
 *
 * MÔ TẢ TOOL LÀ NƠI DUY NHẤT DẠY MODEL KHI NÀO NÊN GHI - không có luật nào về
 * memory trong persona. Hermes chọn đúng cách này ("Behavioral guidance lives in
 * the tool schema description", `tools/memory_tool.py`); giữ ở một chỗ thì không
 * có hai bản hướng dẫn trôi khỏi nhau.
 *
 * Bản mô tả đầu chỉ nói ĐỪNG làm gì ("chỉ dùng khi...", "không lưu chuyện vặt")
 * và đo được kết quả: 1 fact trên 92 lượt agent. Bản này theo cấu trúc của
 * Hermes - nói CHỦ ĐỘNG làm gì trước, kèm thứ tự ưu tiên, rồi mới tới danh sách
 * bỏ qua.
 */
const MO_TA = [
  "Lưu điều đáng nhớ về người đang chat hoặc về nhóm, dùng lại được ở những lần trò chuyện sau.",
  "Điều đã nhớ được nhét vào MỌI lượt sau, nên viết ngắn và đúng trọng tâm.",
  "",
  "KHI NÀO: chủ động lưu ngay khi người dùng nói ra sở thích, thói quen, thông tin cá nhân,",
  "hoặc ĐÍNH CHÍNH điều bạn đang nhớ sai. Thứ tự ưu tiên: người dùng đính chính > sở thích và",
  "thông tin cá nhân > quyết định đã chốt, việc đã hứa.",
  "Trí nhớ tốt là trí nhớ khiến người ta không phải nhắc lại lần thứ hai.",
  "",
  "SỬA VÀ XÓA: nhớ sai thì dùng action 'sua' - ĐỪNG thêm điều mới chồng lên, để lại hai điều",
  "mâu thuẫn còn tệ hơn không nhớ gì. Điều chỉ đúng một lúc rồi hết (đang ốm, đang đi công tác)",
  "thì 'xoa' khi đã qua. Cả hai đều cần 'doan_chu': một đoạn chữ ngắn khớp đúng điều cũ.",
  "",
  "KHÔNG LƯU: chuyện vặt một lần, thứ hỏi lại là biết ngay, nội dung bạn vừa đọc được từ web",
  "hay từ file người khác gửi, tiến độ việc đang làm dở.",
].join("\n");

/**
 * Câu trả cho model khi sửa/xóa không khớp - nói rõ phải làm gì tiếp.
 *
 * Liệt kê lại điều đang nhớ đúng như Hermes làm ("Check current_entries below
 * and retry"): model không thấy id nên nếu chỉ báo "không khớp" thì nó không có
 * đường nào sửa, chỉ còn nước đoán tiếp.
 */
function cauTraKhiHong(ketQua: Extract<KetQuaSuaFact, { ok: false }>) {
  if (ketQua.loai === "khop_nhieu") {
    const ds = ketQua.factKhop.map((c) => `- ${c}`).join("\n");
    return ketQuaLoi(
      `Đoạn chữ đó khớp nhiều điều đang nhớ, không rõ là cái nào:\n${ds}\nGọi lại với đoạn chữ cụ thể hơn.`,
    );
  }
  if (ketQua.factHienCo.length === 0) {
    return ketQuaLoi("Chưa nhớ điều gì về đối tượng này nên không có gì để sửa hoặc xóa.");
  }
  const ds = ketQua.factHienCo.map((c) => `- ${c}`).join("\n");
  return ketQuaLoi(
    `Không điều nào đang nhớ chứa đoạn chữ đó. Đang nhớ:\n${ds}\nGọi lại với đoạn chữ lấy từ đúng danh sách trên.`,
  );
}

export function createSaveMemoryTool({ account, message }: ToolContext) {
  return tool({
    description: MO_TA,
    inputSchema: z.object({
      action: z
        .enum(["them", "sua", "xoa"])
        .default("them")
        .describe(
          "'them' = nhớ điều mới; 'sua' = sửa điều đang nhớ sai; 'xoa' = bỏ điều không còn đúng",
        ),
      content: z
        .string()
        .min(5)
        .max(500)
        .optional()
        .describe(
          "Nội dung cần nhớ, 1-2 câu ngắn gọn, vd 'Anh Hải thích cà phê đen, không đường'. Bắt buộc với 'them' và 'sua'.",
        ),
      doan_chu: z
        .string()
        .min(3)
        .optional()
        .describe(
          "Đoạn chữ ngắn khớp đúng điều đang nhớ cần sửa/xóa, lấy từ chính nội dung đó. Bắt buộc với 'sua' và 'xoa'.",
        ),
      about: z
        .enum(["sender", "thread"])
        .describe("'sender' = về người vừa nhắn; 'thread' = về nhóm/cuộc trò chuyện này"),
    }),
    execute: async ({ action, content, doan_chu, about }) => {
      const subjectId = about === "sender" ? message.senderId : message.threadId;
      if (!subjectId) return ketQuaLoi("Không xác định được đối tượng để lưu");

      // `?? "them"` chứ không dựa vào `.default()` của Zod: default chỉ chạy khi
      // input đi qua schema. Model bỏ trống `action` thì SDK có parse nên vẫn ra
      // "them", nhưng mọi đường gọi thẳng `execute` (test, và bất cứ chỗ nào
      // sau này dựng args bằng tay) sẽ nhận `undefined` rồi rơi vào nhánh
      // sửa/xóa - tức là bỏ trống action thành BÁO LỖI thay vì ghi nhớ.
      const hanhDong = action ?? "them";

      if (hanhDong === "them") {
        if (!content) return ketQuaLoi("Thiếu nội dung cần nhớ");
        const kq = saveMemoryFact({
          accountId: account.id,
          subjectId,
          content,
          learnedInThreadId: message.threadId,
          learnedInGroup: message.isGroup,
        });
        // KHÔNG phải lỗi: điều cần nhớ vẫn đang nằm trong trí nhớ, đúng như model
        // muốn. Nhưng phải nói rõ là không ghi thêm bản nào, kẻo model tưởng hỏng
        // rồi gọi lại. Cùng ngữ nghĩa với "Entry already exists" của Hermes.
        if (!kq.ghi) return `Điều này đã có sẵn trong trí nhớ, không ghi thêm bản trùng: ${content}`;
        return `Đã ghi nhớ: ${content}`;
      }

      if (!doan_chu) return ketQuaLoi("Thiếu đoạn chữ để tìm điều cần sửa hoặc xóa");

      // Hẹp đúng bằng tập model đang NHÌN THẤY: trong nhóm, điều nhớ về một
      // NGƯỜI chỉ đụng được nếu học ngay trong nhóm. Không siết thì vừa sửa/xóa
      // được fact học ở chat riêng, vừa rò chúng ra qua câu báo lỗi.
      const pham: PhamViSuaFact = {
        accountId: account.id,
        subjectId,
        chiFactHocTrongNhom: message.isGroup && about === "sender",
      };

      if (hanhDong === "xoa") {
        const kq = xoaFactTheoDoanChu(pham, doan_chu);
        return kq.ok ? `Đã bỏ khỏi trí nhớ: ${kq.noiDungCu}` : cauTraKhiHong(kq);
      }

      if (!content) return ketQuaLoi("Thiếu nội dung mới để thay vào");
      const kq = suaFactTheoDoanChu(pham, doan_chu, content);
      return kq.ok ? `Đã sửa lại: "${kq.noiDungCu}" -> "${content}"` : cauTraKhiHong(kq);
    },
  });
}
