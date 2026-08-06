import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * Schema của tool KHÔNG chỉ nằm trong nhà - nó bay thẳng sang nhà cung cấp LLM
 * ở MỌI lượt. Nhà cung cấp nào soi chặt hơn thì một cấu trúc hợp lệ với zod vẫn
 * làm chối cả request, và vì bộ tool đi kèm mọi lượt nên bot CÂM HOÀN TOÀN chứ
 * không riêng lượt nào dùng tới tool đó.
 *
 * Đã trả giá thật 06/08/2026: `z.tuple()` trong `create_excel_file` dịch ra JSON
 * Schema draft-07 với `items` là MẢNG. Lớp OpenAI-compatible của Google chỉ nhận
 * 2020-12 (ở đó `items` phải là object hoặc boolean) nên trả 400 cho mọi tin
 * nhắn. 9router và Anthropic đều nuốt dạng cũ, nên lỗi nằm im tới lúc đổi nhà
 * cung cấp - đúng loại bẫy mà test phải bắt thay vì đợi người dùng phát hiện.
 *
 * Test này quét CẤU TRÚC, không phải một tool cụ thể: ai đó thêm `z.tuple()` vào
 * tool mới thì đỏ ngay tại chỗ.
 */

let dataDir: string;
let registry: typeof import("./tool-registry.js");
let visionStore: typeof import("../../config/runtime-vision-settings.js");
let imageStore: typeof import("../../config/runtime-image-settings.js");
let aiMod: typeof import("ai");

before(async () => {
  dataDir = setupTestEnv();
  registry = await import("./tool-registry.js");
  visionStore = await import("../../config/runtime-vision-settings.js");
  imageStore = await import("../../config/runtime-image-settings.js");
  aiMod = await import("ai");

  // Bật hạ tầng của 2 tool có cửa kiểm, để bộ quét thấy ĐỦ 13 tool chứ không
  // âm thầm bỏ sót đúng tool đang hỏng
  visionStore.updateVisionSettings({
    sidecarBaseUrl: "https://vision.test/v1",
    sidecarModel: "m",
    sidecarApiKey: "k",
  });
  imageStore.updateImageSettings({ baseUrl: "https://router.test", model: "m", apiKey: "k" });
});

after(async () => {
  const { closeDatabase } = await import("../../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

function makeContext() {
  return {
    api: {} as API,
    account: {
      id: "acc-test",
      label: "Test",
      enabled: true,
      agentId: "agent-test",
      allowlist: { mode: "all" as const, userIds: [] },
      groupRequireMention: true,
      respondToGroups: true,
      groupPassiveListen: true,
      autoReactEnabled: true,
      autoReactIcon: "heart",
      typingIndicatorEnabled: true,
      disabledTools: [],
    },
    agent: fakeAgentProfile(),
    message: { threadId: "t-1", threadType: 0 } as never,
    batch: [],
  };
}

/** Mọi nút trong cây JSON Schema, kèm đường dẫn để câu báo lỗi chỉ đúng chỗ */
function* moiNut(nut: unknown, duongDan: string): Generator<{ duongDan: string; nut: Record<string, unknown> }> {
  if (Array.isArray(nut)) {
    for (let i = 0; i < nut.length; i++) yield* moiNut(nut[i], `${duongDan}[${i}]`);
    return;
  }
  if (nut === null || typeof nut !== "object") return;
  const obj = nut as Record<string, unknown>;
  yield { duongDan, nut: obj };
  for (const [khoa, con] of Object.entries(obj)) yield* moiNut(con, `${duongDan}.${khoa}`);
}

function schemaCuaTungTool(): { ten: string; schema: unknown }[] {
  const tools = registry.buildAgentTools(makeContext() as never);
  return Object.entries(tools).map(([ten, t]) => ({
    ten,
    // Đúng đường mà nhà cung cấp nhận: AI SDK dịch `inputSchema` sang JSON Schema
    // rồi gói vào `tools[].function.parameters`
    schema: aiMod.asSchema((t as { inputSchema: never }).inputSchema).jsonSchema,
  }));
}

describe("schema tool - hình dạng mà nhà cung cấp soi chặt vẫn nhận", () => {
  it("quét được đủ bộ tool, không phải mảng rỗng đọc ra như đã đạt", () => {
    const ds = schemaCuaTungTool();
    assert.ok(ds.length >= 13, `chỉ dựng được ${ds.length} tool - bộ quét đang nhìn hụt`);
  });

  it("KHÔNG tool nào có `items` dạng mảng (tuple draft-07) - Google chối cả request", () => {
    const pham: string[] = [];

    for (const { ten, schema } of schemaCuaTungTool()) {
      for (const { duongDan, nut } of moiNut(schema, ten)) {
        if (Array.isArray(nut.items)) pham.push(`${duongDan}.items`);
      }
    }

    assert.deepEqual(
      pham,
      [],
      `Chỗ này dịch từ z.tuple(). Đổi sang z.array(x).length(n) - ràng buộc lúc chạy y hệt ` +
        `mà JSON Schema thì mọi nhà cung cấp đều nhận:\n  ${pham.join("\n  ")}`,
    );
  });

  /**
   * `Schema.enum` trong API của Google là `repeated string`, chỉ nhận chuỗi.
   *
   * PHẢI kiểm CẢ `const` chứ không chỉ `enum`, và đây là chỗ suýt viết sai: zod
   * dịch `z.union([z.literal(1), ...])` ra `anyOf: [{type:"number",const:1}...]`,
   * KHÔNG ra `enum`. Chính provider Google trong AI SDK mới gộp `const` thành
   * `enum: [1]` lúc dựng `functionDeclarations` - nên câu lỗi của Google nói
   * `any_of[0].enum[0]` trong khi schema mình gửi đi chẳng có `enum` nào. Một
   * luật chỉ nhìn `enum` sẽ XANH ngay cả khi lỗi thật đang nằm đó (đã kiểm bằng
   * cách phá code: trả `level` về union literal mà luật không đỏ).
   */
  it("MỌI `const` và `enum` phải là chuỗi - Google dựng enum từ chúng và chỉ nhận chuỗi", () => {
    const pham: string[] = [];

    for (const { ten, schema } of schemaCuaTungTool()) {
      for (const { duongDan, nut } of moiNut(schema, ten)) {
        if ("const" in nut && typeof nut.const !== "string") {
          pham.push(`${duongDan}.const = ${JSON.stringify(nut.const)}`);
        }
        if (!Array.isArray(nut.enum)) continue;
        for (let i = 0; i < nut.enum.length; i++) {
          const v = nut.enum[i];
          if (typeof v !== "string") pham.push(`${duongDan}.enum[${i}] = ${JSON.stringify(v)}`);
        }
      }
    }

    assert.deepEqual(
      pham,
      [],
      `Chỗ này thường dịch từ union literal SỐ. Đổi sang khoảng số ` +
        `(z.number().int().min(a).max(b)) - không sinh const/enum mà ràng buộc vẫn tương đương:\n  ` +
        pham.join("\n  "),
    );
  });

  it("bộ quét ĐI TỚI được chỗ sâu nhất, không dừng ở tầng mặt", () => {
    // Ô công thức nhân nằm ở sheets[].rows[][].anyOf[n] - chính chỗ đã hỏng.
    // Không có khẳng định này thì một bộ quét chỉ nhìn tầng một vẫn xanh.
    const excel = schemaCuaTungTool().find((x) => x.ten === "create_excel_file");
    assert.ok(excel, "không dựng được create_excel_file");

    const coCotNhan = [...moiNut(excel.schema, "root")].some(
      (x) => x.nut.pattern === "^[A-Za-z]{1,2}$",
    );
    assert.ok(coCotNhan, "bộ quét không chạm tới schema chữ cái cột - nó đang bỏ sót nhánh sâu");
  });

  it("bộ quét THẤY được cả nút `const` lẫn nút `enum` - không thì luật kia đúng rỗng", () => {
    // Luật "const/enum phải là chuỗi" xanh cả khi bộ quét không tìm ra nút nào.
    // Khẳng định này phân biệt "không có vi phạm" với "không nhìn thấy gì".
    const nut = schemaCuaTungTool().flatMap(({ ten, schema }) => [...moiNut(schema, ten)]);
    const soConst = nut.filter((x) => "const" in x.nut).length;
    const soEnum = nut.filter((x) => Array.isArray(x.nut.enum)).length;

    assert.ok(soConst > 0, "không thấy nút const nào trong cả 13 tool - bộ quét đang mù");
    assert.ok(soEnum > 0, "không thấy nút enum nào trong cả 13 tool - bộ quét đang mù");
  });
});
