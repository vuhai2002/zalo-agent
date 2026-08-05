import type { API } from "zca-js";

/**
 * API Zalo GIẢ cho bộ eval.
 *
 * ĐÂY LÀ HÀNG RÀO AN TOÀN QUAN TRỌNG NHẤT của cả bộ eval. `runAgentTurn` nhận
 * `api: API` của zca-js, và các tool nhóm `action` (`send_file`, `tag_member`,
 * `add_reaction`, `create_image`, `create_word_document`, `create_excel_file`)
 * gọi THẲNG `enqueueSend` để gửi. Chạy eval với API thật là bot nhắn thật cho
 * người thật - không phải rủi ro lý thuyết, đó là hành vi mặc định nếu quên
 * tiêm.
 *
 * Mọi hàm GHI LẠI lời gọi rồi trả về giá trị rỗng hợp lệ, nên runner khẳng định
 * được cả "có gửi gì ra ngoài không" chứ không chỉ "có gọi tool nào".
 */

export type LoiGoiApi = { ham: string; thamSo: unknown[] };

export type FakeZaloApi = {
  api: API;
  /** Mọi lời gọi đã ghi, theo thứ tự */
  loiGoi: LoiGoiApi[];
  /** Nội dung các tin ĐÃ "gửi" - dùng để khẳng định eval không nhắn ra ngoài */
  tinDaGui: string[];
  /**
   * Tin kèm ĐỊNH DẠNG, đúng payload đi vào `sendMessage`.
   *
   * Tách khỏi `tinDaGui` để không đụng vào chỗ đã dùng, nhưng đây mới là thứ đo
   * được chất lượng trình bày: `tinDaGui` là chữ trần sau khi dịch nên dấu `**`
   * đã biến mất, không cách nào biết có in đậm hay không.
   */
  tinKemDinhDang: { msg: string; styles?: { start: number; len: number; st: string }[] }[];
  xoaGhiChep(): void;
};

export function taoFakeZaloApi(): FakeZaloApi {
  const loiGoi: LoiGoiApi[] = [];
  const tinDaGui: string[] = [];
  const tinKemDinhDang: FakeZaloApi["tinKemDinhDang"] = [];

  const ghi = (ham: string, ...thamSo: unknown[]): void => {
    loiGoi.push({ ham, thamSo });
  };

  const api = {
    getOwnId: () => "eval-self",

    sendMessage: async (
      payload: { msg?: string; styles?: { start: number; len: number; st: string }[] },
      threadId: string,
      threadType: number,
    ) => {
      ghi("sendMessage", payload, threadId, threadType);
      tinDaGui.push(payload?.msg ?? "");
      tinKemDinhDang.push({ msg: payload?.msg ?? "", styles: payload?.styles });
      return { msgId: `eval-${tinDaGui.length}`, cliMsgId: `c-${tinDaGui.length}` };
    },

    addReaction: async (icon: unknown, target: unknown) => {
      ghi("addReaction", icon, target);
      return {};
    },

    sendTypingEvent: async (threadId: string, threadType: number) => {
      ghi("sendTypingEvent", threadId, threadType);
      return {};
    },

    sendSeenEvent: async (...a: unknown[]) => {
      ghi("sendSeenEvent", ...a);
      return {};
    },

    getGroupInfo: async (threadId: string) => {
      ghi("getGroupInfo", threadId);
      // Hình dạng tối thiểu mà `get-group-info-tool.ts` đọc
      return { gridInfoMap: { [threadId]: { name: "Nhóm eval", totalMember: 2, memVerList: [] } } };
    },

    listener: {
      on: () => {},
      onConnected: () => {},
      onError: () => {},
      onClosed: () => {},
      start: () => {},
      stop: () => {},
    },
  } as unknown as API;

  return {
    api,
    loiGoi,
    tinDaGui,
    tinKemDinhDang,
    xoaGhiChep() {
      loiGoi.length = 0;
      tinDaGui.length = 0;
      tinKemDinhDang.length = 0;
    },
  };
}
