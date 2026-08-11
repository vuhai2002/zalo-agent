import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Bất biến làm cho việc cho `ToolContext.api` nullable trở nên AN TOÀN: trên
 * kênh bot (`api === null`), KHÔNG tool nào được cấp mà lại cần zca-js.
 *
 * Bản đầu của file này so hai DANH SÁCH VIẾT TAY với nhau - một trong hai là
 * bản chép tay của chính thứ cần kiểm, nên thêm `apiCaNhan()` vào tool thứ 8
 * thì cả hai danh sách đều không đổi và test vẫn xanh. Nay đo bằng cách DỰNG
 * THẬT bộ tool với `api: null`.
 *
 * Chuyện này đáng canh hơn vẻ ngoài của nó: 5 trong 7 tool gọi `apiCaNhan` ở
 * lúc DỰNG (không phải lúc chạy), nên bất biến vỡ là `buildAgentTools` ném và
 * chết CẢ lượt - bot câm hoàn toàn chứ không phải thiếu một năng lực.
 */
let dataDir: string;
let registry: typeof import("../agent/tools/tool-registry.js");
let types: typeof import("../agent/tools/tool-catalog-types.js");
let accounts: typeof import("../config/account-store.js");
let agents: typeof import("../config/agent-store.js");
let nangLuc: typeof import("./nang-luc-kenh-bot.js");

before(async () => {
  dataDir = setupTestEnv();
  registry = await import("../agent/tools/tool-registry.js");
  types = await import("../agent/tools/tool-catalog-types.js");
  accounts = await import("../config/account-store.js");
  agents = await import("../config/agent-store.js");
  nangLuc = await import("./nang-luc-kenh-bot.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const tinGia = { threadId: "t1", threadType: 0, senderId: "u1" } as never;

describe("apiCaNhan - khẳng định api của kênh cá nhân", () => {
  it("có api thì trả về chính nó", () => {
    const api = { sendMessage: () => {} } as never;
    assert.equal(types.apiCaNhan({ api }), api);
  });

  it("null thì NÉM kèm câu nói rõ chuyện gì, không phải TypeError trần", () => {
    // Ai nối kênh mới sau này mà quên chặn tool sẽ vấp vào đây. "Cannot read
    // property of null" không nói được gì; câu này chỉ thẳng chỗ phải sửa.
    const err = (() => {
      try {
        types.apiCaNhan({ api: null });
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    assert.ok(err, "api null mà không ném");
    assert.match(err.message, /tài khoản cá nhân/);
    assert.match(err.message, /listAvailableTools/);
  });

  it("dựng THẬT bộ tool trên kênh bot với api null: KHÔNG tool nào ném", async () => {
    // Phép đo thay cho bản so-hai-danh-sách cũ. Thêm `apiCaNhan()` vào một tool
    // KHÔNG nằm trong bảng chặn thì ca này đỏ ngay tại đây, thay vì ném giữa
    // lượt thật trước mặt người nhắn.
    const agent = agents.ensureDefaultAgent();
    const acc = accounts.createAccount({ id: "bot-1", label: "Bot" });

    const tools = registry.buildAgentTools({
      api: null,
      account: { ...acc, loai: "bot" },
      agent,
      message: tinGia,
      batch: [],
    });

    assert.ok(Object.keys(tools).length > 0, "không dựng được tool nào - phép đo thành vô nghĩa");
    // Và đúng những tool cần zca-js phải VẮNG MẶT
    for (const k of ["send_file", "create_image", "add_reaction", "tag_member", "get_group_info"]) {
      assert.ok(!(k in tools), `"${k}" được cấp trên kênh bot dù cần zca-js`);
    }
  });

  it("MỌI tool gọi `apiCaNhan` đều nằm trong bảng chặn - đo theo NGUỒN", async () => {
    // Ca "dựng thật" ở trên chỉ phủ nhánh BUILD-TIME. Hai tool tài liệu
    // (`create_word_document`, `create_excel_file`) gọi `apiCaNhan` lúc CHẠY
    // chứ không lúc dựng, nên chúng lọt qua phép đo đó. Ca này đọc thẳng mã
    // nguồn nên phủ cả hai nhánh, và KHÔNG phải bản chép tay của thứ cần kiểm.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const thuMuc = path.join(process.cwd(), "src", "agent", "tools");

    const fileDungApi = fs
      .readdirSync(thuMuc)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => fs.readFileSync(path.join(thuMuc, f), "utf8").includes("apiCaNhan("))
      // `tool-catalog-types.ts` là nơi ĐỊNH NGHĨA hàm, không phải nơi dùng
      .filter((f) => f !== "tool-catalog-types.ts");

    assert.ok(fileDungApi.length > 0, "không tìm thấy file nào gọi apiCaNhan - phép đo hỏng");

    // Ánh xạ file -> key tool qua chính catalog: mỗi định nghĩa tool có `build`
    // trỏ tới hàm khởi tạo, mà hàm đó nằm trong đúng những file trên.
    const catalog = await import("../agent/tools/tool-catalog.js");
    const chan = new Set(Object.keys(nangLuc.TOOL_KHONG_CHAY_TREN_BOT));
    const nguon = new Map(
      fileDungApi.map((f) => [f, fs.readFileSync(path.join(thuMuc, f), "utf8")] as const),
    );

    for (const def of catalog.TOOL_DEFINITIONS) {
      // Tool này có được dựng từ một file dùng `apiCaNhan` không?
      const ten = def.build.toString();
      const dungApi = [...nguon].some(([, noiDung]) => {
        const ham = ten.match(/(create[A-Za-z]+)\(/)?.[1];
        return Boolean(ham && noiDung.includes(`export function ${ham}`));
      });
      if (dungApi) {
        assert.ok(chan.has(def.key), `"${def.key}" cần zca-js nhưng KHÔNG nằm trong bảng chặn kênh bot`);
      }
    }
  });

  it("cùng scope đó trên kênh CÁ NHÂN vẫn cấp được tool cần zca-js", () => {
    // Đối chứng: nếu ca trên xanh chỉ vì `buildAgentTools` không cấp gì cả thì
    // ca này lộ ra ngay.
    const agent = agents.ensureDefaultAgent();
    const acc = accounts.getAccount("bot-1")!;
    const tools = registry.buildAgentTools({
      api: { sendMessage: () => {} } as never,
      account: { ...acc, loai: "ca_nhan" },
      agent,
      message: tinGia,
      batch: [],
    });
    assert.ok("send_file" in tools, "kênh cá nhân cũng không cấp send_file - phép đo hỏng");
  });
});
