import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Tham số chỉnh từ dashboard đè lên `.env`, và phải ĐỌC LẠI mỗi lần gọi - cache
 * ở đây là quay về đúng vấn đề cũ: phải khởi động lại mới thấy thay đổi.
 */

let dataDir: string;
let tuning: typeof import("./runtime-tuning-settings.js");
let database: typeof import("../conversation/database.js");
let env: typeof import("./env.js").env;

before(async () => {
  dataDir = setupTestEnv({ LLM_MAX_STEPS: "8", LLM_REASONING_EFFORT: "medium" });
  tuning = await import("./runtime-tuning-settings.js");
  database = await import("../conversation/database.js");
  ({ env } = await import("./env.js"));
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM runtime_settings WHERE key LIKE 'tuning_%';");
});

describe("getTuning - DB đè env", () => {
  it("chưa đặt gì thì lấy giá trị trong .env", () => {
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8);
  });

  it("đặt rồi thì lấy giá trị mới NGAY, không cần khởi động lại", () => {
    tuning.setTuning("LLM_MAX_STEPS", 12);
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 12, "đọc lại phải thấy ngay - cache là hỏng cả mục đích");
  });

  it("null = xóa đè, quay về .env", () => {
    tuning.setTuning("LLM_MAX_STEPS", 12);
    tuning.setTuning("LLM_MAX_STEPS", null);
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8);
  });

  it("giá trị ngoài khoảng cho phép bị bỏ qua thay vì làm chết bot", () => {
    database.db
      .prepare("INSERT INTO runtime_settings (key, value) VALUES ('tuning_LLM_MAX_STEPS', '9999')")
      .run();
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8, "sửa tay trong DB không được phá bot");
  });

  it("giá trị không phải số cũng rơi về .env", () => {
    database.db
      .prepare("INSERT INTO runtime_settings (key, value) VALUES ('tuning_LLM_MAX_STEPS', 'tam')")
      .run();
    assert.equal(tuning.getTuning("LLM_MAX_STEPS"), 8);
  });

  it("kiểu bật/tắt đọc đúng", () => {
    tuning.setTuning("AGENT_TRACE_ENABLED", false);
    assert.equal(tuning.getTuning("AGENT_TRACE_ENABLED"), false);
    tuning.setTuning("AGENT_TRACE_ENABLED", true);
    assert.equal(tuning.getTuning("AGENT_TRACE_ENABLED"), true);
  });

  it("kiểu chọn: giá trị lạ rơi về .env", () => {
    tuning.setTuning("LLM_REASONING_EFFORT", "sieu-cao");
    assert.equal(tuning.getTuning("LLM_REASONING_EFFORT"), "medium");
    tuning.setTuning("LLM_REASONING_EFFORT", "high");
    assert.equal(tuning.getTuning("LLM_REASONING_EFFORT"), "high");
  });

  it("listTuning nói rõ ô nào đang lấy từ .env", () => {
    tuning.setTuning("LLM_MAX_STEPS", 5);
    const ds = tuning.listTuning();
    assert.equal(ds.find((x) => x.key === "LLM_MAX_STEPS")?.fromEnv, false);
    assert.equal(ds.find((x) => x.key === "WEB_FETCH_MAX_CHARS")?.fromEnv, true);
  });
});

/**
 * Ràng buộc GIỮA các tham số. Nhìn hai ô nhập rời nhau thì không ai nhận ra
 * đặt trần lượt thấp hơn trần vẽ ảnh là giết ngang lượt vẽ hợp lệ.
 */
describe("validateTuning - ràng buộc chéo", () => {
  it("trần lượt phải lớn hơn trần vẽ ảnh", () => {
    const loi = tuning.validateTuning({ LLM_TURN_TIMEOUT_MS: 300_000, IMAGE_GEN_TIMEOUT_MS: 600_000 });
    // Kiểm đúng câu lỗi thay vì đếm: các luật khác cũng chạy trên cùng bộ giá
    // trị, đếm số lỗi là buộc test vào luật không liên quan
    assert.ok(loi.some((l) => /lớn hơn trần thời gian mỗi ảnh/.test(l)));
  });

  it("kiểm được cả khi chỉ sửa MỘT ô - ô kia lấy giá trị hiện tại", () => {
    tuning.setTuning("IMAGE_GEN_TIMEOUT_MS", 600_000);
    const loi = tuning.validateTuning({ LLM_TURN_TIMEOUT_MS: 120_000 });
    assert.ok(loi.length > 0, "chỉ gửi 1 ô vẫn phải bắt được");
  });

  it("thời gian im lặng phải nhỏ hơn trần mỗi ảnh", () => {
    const loi = tuning.validateTuning({ IMAGE_GEN_STALL_MS: 300_000, IMAGE_GEN_TIMEOUT_MS: 100_000 });
    assert.ok(loi.some((l) => /im lặng/.test(l)));
  });

  it("giãn nhịp gửi tối thiểu không được lớn hơn tối đa", () => {
    const loi = tuning.validateTuning({ SEND_DELAY_MIN_MS: 5000, SEND_DELAY_MAX_MS: 1000 });
    assert.ok(loi.some((l) => /tối thiểu/.test(l)));
  });

  it("trần ký tự tài liệu quá lớn so với trần token thì chặn", () => {
    const loi = tuning.validateTuning({ DOCUMENT_MAX_CHARS: 400_000, LLM_MAX_OUTPUT_TOKENS: 16_384 });
    assert.ok(loi.some((l) => /tài liệu/.test(l)));
  });

  it("trần context quá thấp so với trần token viết ra thì chặn", () => {
    // Bot chỉ dùng tới 70% trần context; 30% còn lại phải đủ chứa phần model
    // viết ra. Đặt trần context ở mức tối thiểu 4.000 trong khi output tối đa
    // 16.384 là cấu hình tự mâu thuẫn - phần chừa đã bị output ăn sạch.
    const loi = tuning.validateTuning({ LLM_CONTEXT_WINDOW: 4_000, LLM_MAX_OUTPUT_TOKENS: 16_384 });
    assert.ok(loi.some((l) => /viết ra/.test(l)), `phải chặn, nhận: ${JSON.stringify(loi)}`);
  });

  it("mặc định 128.000 với 16.384 thì hợp lệ - đối chứng cho ca trên", () => {
    const loi = tuning.validateTuning({ LLM_CONTEXT_WINDOW: 128_000, LLM_MAX_OUTPUT_TOKENS: 16_384 });
    assert.deepEqual(loi, [], "cấu hình mặc định không được báo lỗi");
  });

  it("bộ mặc định KHI PHÁT HÀNH hợp lệ - không tự chặn chính mình", () => {
    // Ghi thẳng giá trị mặc định của schema env chứ không đọc env: môi trường
    // test cố tình hạ LLM_MAX_OUTPUT_TOKENS xuống 2048 cho nhẹ, đọc env ở đây
    // là test đi kiểm cấu hình test thay vì cấu hình người dùng thật nhận được.
    assert.deepEqual(
      tuning.validateTuning({
        LLM_TURN_TIMEOUT_MS: 900_000,
        IMAGE_GEN_TIMEOUT_MS: 600_000,
        IMAGE_GEN_STALL_MS: 90_000,
        SEND_DELAY_MIN_MS: 800,
        SEND_DELAY_MAX_MS: 2500,
        DOCUMENT_MAX_CHARS: 20_000,
        LLM_MAX_OUTPUT_TOKENS: 16_384,
      }),
      [],
    );
  });

  it("trần token thấp mà trần tài liệu cao thì chặn - đúng ca môi trường test đang dính", () => {
    const loi = tuning.validateTuning({ DOCUMENT_MAX_CHARS: 20_000, LLM_MAX_OUTPUT_TOKENS: 2048 });
    assert.ok(loi.some((l) => /tài liệu/.test(l)), "2048 token không viết nổi 20.000 ký tự");
  });

  describe("kb: trần kết quả phải chứa nổi số đoạn x độ dài đoạn (I2)", () => {
    it("dashboard từ chối tổ hợp mà trần nhỏ hơn tổng đoạn sẽ lấy", () => {
      const loi = tuning.validateTuning({ KB_TOP_K: 20, KB_CHUNK_CHARS: 1600, KB_MAX_RESULT_CHARS: 4000 });
      assert.ok(loi.length > 0, "tổ hợp này làm phần lớn đoạn bị vứt lặng lẽ mà không ai báo");
    });

    it("hạ KB_MAX_RESULT_CHARS xuống dưới mức cần cho cấu hình HIỆN CÓ cũng bị chặn dù chỉ sửa một ô", () => {
      // Đúng cơ chế validateTuning: chỉ ô sửa nằm trong `sau`, KB_TOP_K/KB_CHUNK_CHARS
      // lấy giá trị HIỆN TẠI (mặc định) - vẫn phải bắt được, không cần gửi đủ 3 ô.
      const loi = tuning.validateTuning({ KB_MAX_RESULT_CHARS: 600 });
      assert.ok(loi.length > 0, "chỉ gửi 1 ô vẫn phải bắt được khi kết hợp với giá trị hiện tại đã vượt trần");
    });

    it("tổ hợp có đủ chỗ thì KHÔNG bị chặn - đối chứng cho ca trên", () => {
      // Công thức thật (vòng rà soát lần 3, cộng cả chồng lấn):
      // KB_TOP_K * (KB_CHUNK_CHARS*(1+overlap%/100) + 150) + 520. Overlap
      // không truyền -> lấy mặc định 10%: 3*(1000*1.1+150)+520 = 4270 <= 4500.
      const loi = tuning.validateTuning({ KB_TOP_K: 3, KB_CHUNK_CHARS: 1000, KB_MAX_RESULT_CHARS: 4500 });
      assert.deepEqual(loi, [], `3*(1000*1.1+150)+520=4270 <= 4500 phải hợp lệ, nhận: ${JSON.stringify(loi)}`);
    });

    it("chồng lấn cao đẩy nội dung thật vượt trần dù KB_CHUNK_CHARS trông có vẻ vừa (Important 3, vòng rà soát lần 3)", () => {
      // Ca ĐÚNG người rà soát đo: topK=10, chunk=1200, chồng lấn 50% -> nội
      // dung THẬT mỗi đoạn tới 1800 ký tự (1200*1.5), không phải 1200. Luật
      // BỎ chồng lấn (vòng 2) đòi 10*(1200+140)+520=13920 - trần 15000 sẽ lọt
      // qua. Luật CÓ chồng lấn (vòng 3) đòi 10*(1200*1.5+150)+520=20020 -
      // cùng trần 15000 phải bị chặn.
      const loi = tuning.validateTuning({
        KB_TOP_K: 10,
        KB_CHUNK_CHARS: 1200,
        KB_CHUNK_OVERLAP_PERCENT: 50,
        KB_MAX_RESULT_CHARS: 15_000,
      });
      assert.ok(
        loi.length > 0,
        "chồng lấn 50% đẩy nhu cầu thật lên ~20.020 - trần 15.000 phải bị chặn, không được lọt qua như luật thiếu số hạng chồng lấn",
      );
    });

    it("mặc định PHÁT HÀNH của chính repo (env.ts) THỎA ràng buộc chéo", () => {
      // Bất biến chống hồi quy quan trọng nhất của phase này: mặc định TỰ MÂU
      // THUẪN chính là lỗi gốc của I2 (KB_TOP_K=5 và =20 từng cho ra kết quả
      // GIỐNG HỆT NHAU vì KB_MAX_RESULT_CHARS mặc định quá nhỏ). Đọc THẲNG
      // `env` (không hardcode literal như các test khác trong file này) - CỐ Ý
      // khác quy ước: setupTestEnv() không override bất kỳ biến KB_* nào, nên
      // `env.KB_*` ở đây LÀ giá trị người dùng thật nhận được; đọc thẳng mới
      // bắt được hồi quy trong TƯƠNG LAI (ai đó đổi một mặc định mà quên cái
      // kia) - hardcode literal chỉ khoá cứng lại đúng bộ số hôm nay, không
      // canh được lần đổi sau.
      assert.deepEqual(
        tuning.validateTuning({
          KB_TOP_K: env.KB_TOP_K,
          KB_CHUNK_CHARS: env.KB_CHUNK_CHARS,
          KB_MAX_RESULT_CHARS: env.KB_MAX_RESULT_CHARS,
        }),
        [],
      );
    });
  });
});

describe("video: dung lượng x số lượt song song phải nằm gọn trong RAM máy chủ", () => {
  /**
   * Byte video giờ nằm trong RAM chứ không ghi ra đĩa nữa. Hai thanh trượt trên
   * dashboard nhìn RIÊNG RẼ thì ô nào cũng hợp lệ, nhưng nhân lên là 2000 MB x
   * 8 lượt = 16 GB - đúng loại lỗi chỉ lộ ra khi nhiều tham số kết hợp.
   *
   * `kiemRamVideo` nhận RAM máy làm THAM SỐ nên test được bằng số cố định; luật
   * chéo mới là chỗ đưa `totalmem()` thật vào.
   */
  const RAM_2GB = 2048;

  it("mặc định 100 MB x 2 lượt lọt trên VPS 2 GB", () => {
    assert.equal(tuning.kiemRamVideo(100, 2, RAM_2GB), null);
  });

  it("kịch trần cả hai thanh trượt thì CHẶN", () => {
    const cau = tuning.kiemRamVideo(2000, 8, RAM_2GB);
    assert.ok(cau, "2000 MB x 8 lượt = 16 GB, phải chặn");
    assert.match(cau, /16600 MB/, "phải nói con số đỉnh để người dùng biết hạ bao nhiêu");
    assert.match(cau, /512 MB/, "và nói mức an toàn của máy này");
  });

  it("CỘNG cả RAM của tiến trình tải, không chỉ cỡ video", () => {
    // Mỗi tiến trình yt-dlp ăn ~75 MB CỐ ĐỊNH bất kể video nặng nhẹ. Bỏ qua
    // phần đó là ước thiếu, và ước thiếu ở đây nghĩa là máy chủ hết bộ nhớ.
    assert.equal(tuning.kiemRamVideo(50, 4, RAM_2GB), null, "4 x (50+75) = 500, lọt dưới 512");
    assert.ok(tuning.kiemRamVideo(60, 4, RAM_2GB), "4 x (60+75) = 540 > 512, phải chặn");
  });

  it("máy nhiều RAM hơn thì cho phép cấu hình lớn hơn", () => {
    assert.ok(tuning.kiemRamVideo(500, 4, 4096), "trên 4 GB thì 2300 MB là quá");
    assert.equal(tuning.kiemRamVideo(500, 4, 32768), null, "trên 32 GB thì vẫn còn dư");
  });

  it("luật chéo có nối vào validateTuning cho CẢ HAI ô", () => {
    // Sửa một ô trong cặp vẫn phải kiểm với ô còn lại - không thì đổi số lượt
    // song song mà không đụng dung lượng là lách được luật.
    for (const key of ["VIDEO_MAX_SIZE_MB", "VIDEO_MAX_CONCURRENT"]) {
      const loi = tuning.validateTuning({ VIDEO_MAX_SIZE_MB: 2000, VIDEO_MAX_CONCURRENT: 8, [key]: key === "VIDEO_MAX_SIZE_MB" ? 2000 : 8 });
      assert.ok(
        loi.some((c: string) => c.includes("bộ nhớ lúc cao điểm")),
        `đổi ${key} phải kích hoạt luật`,
      );
    }
  });
});
