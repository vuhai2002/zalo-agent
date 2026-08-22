import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Tầng chạy tiến trình yt-dlp - dùng chung cho cả đường đọc metadata lẫn đường
 * tải file, nên đây là chỗ duy nhất cần canh ba thứ:
 *
 *   1. Danh sách CHO PHÉP biến môi trường (bí mật KHÔNG được chảy vào tiến
 *      trình phân tích nội dung của người lạ).
 *   2. Nhận diện ca THIẾU CÔNG CỤ, ở CẢ HAI hình dạng.
 *   3. Cờ siết bảo mật luôn có mặt.
 *
 * Về (2): bản trước chỉ bắt `ENOENT`. ĐO THẬT bằng `execFile("py", ["-m",
 * "<module không tồn tại>"])` thì `err.code === 1`, KHÔNG phải "ENOENT" - tức
 * ca Docker thật (có python3, thiếu module) rơi vào nhánh chung và model nhận
 * câu "video có thể ở chế độ riêng tư" trong khi bệnh nằm ở Dockerfile.
 */

let dataDir: string;
let mod: typeof import("./chay-yt-dlp.js");

before(async () => {
  dataDir = setupTestEnv({ YTDLP_PATH: "yt-dlp-chac-chan-khong-ton-tai-tren-may-nay" });
  mod = await import("./chay-yt-dlp.js");
});

after(() => cleanupTestEnv(dataDir));

describe("nhận diện ca THIẾU CÔNG CỤ", () => {
  it("thiếu chính binary (ENOENT)", () => {
    assert.equal(mod.laLoiThieuCongCu({ code: "ENOENT" } as NodeJS.ErrnoException, ""), true);
  });

  it("có python nhưng THIẾU MODULE - stderr thật, mã thoát 1 chứ không ENOENT", () => {
    // Chuỗi dưới đây chép nguyên văn từ lần đo thật trên máy này. Đây là ca
    // Docker sẽ gặp (pip install hỏng, đổi base image, gỡ nhầm gói).
    const err = { code: 1 } as unknown as NodeJS.ErrnoException;
    const stderr = "C:\\Python314\\python.exe: No module named yt_dlp";
    assert.equal(mod.laLoiThieuCongCu(err, stderr), true, "bỏ lọt ca này là đổ oan cho video");
  });

  it("bắt cả biến thể gạch ngang và nháy của thông điệp Python", () => {
    const err = { code: 1 } as unknown as NodeJS.ErrnoException;
    for (const s of [
      "/usr/bin/python3: No module named yt-dlp",
      "python3: No module named 'yt_dlp'",
      'python: No module named "yt_dlp"',
      "PYTHON3: NO MODULE NAMED YT_DLP",
    ]) {
      assert.equal(mod.laLoiThieuCongCu(err, s), true, `phải nhận ra: ${s}`);
    }
  });

  it("lỗi THẬT của video KHÔNG bị nhận nhầm thành thiếu công cụ", () => {
    const err = { code: 1 } as unknown as NodeJS.ErrnoException;
    for (const s of [
      "ERROR: [TikTok] 123: Video not available",
      "ERROR: [facebook] 456: Cannot parse data",
      "ERROR: [generic] Unable to extract universal data for rehydration",
      "ERROR: This video is private",
    ]) {
      assert.equal(mod.laLoiThieuCongCu(err, s), false, `không được nhận nhầm: ${s}`);
    }
  });
});

describe("danh sách CHO PHÉP biến môi trường", () => {
  it("KHÔNG chở bí mật sang tiến trình con", () => {
    // Tiến trình này phân tích nội dung của một URL do người lạ gửi. Bất cứ thứ
    // gì nó ghi ra (log gỡ lỗi, báo cáo sự cố) cũng có thể mang biến theo.
    const cu = { ...process.env };
    process.env.CREDENTIALS_ENCRYPTION_KEY = "bi-mat-khong-duoc-lo";
    process.env.LLM_API_KEY = "sk-bi-mat";
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    try {
      const ra = mod.envToiThieu();
      for (const ten of ["CREDENTIALS_ENCRYPTION_KEY", "LLM_API_KEY", "DATABASE_URL"]) {
        assert.equal(ra[ten], undefined, `${ten} KHÔNG được lọt sang tiến trình con`);
      }
    } finally {
      process.env = cu;
    }
  });

  it("KHÔNG chở PYTHONPATH / PYTHONSTARTUP - hai biến nạp mã Python", () => {
    const cu = { ...process.env };
    process.env.PYTHONPATH = "/duong/dan/ke-tan-cong";
    process.env.PYTHONSTARTUP = "/tmp/doc.py";
    try {
      const ra = mod.envToiThieu();
      assert.equal(ra.PYTHONPATH, undefined, "PYTHONPATH nạp module tùy ý vào tiến trình");
      assert.equal(ra.PYTHONSTARTUP, undefined);
    } finally {
      process.env = cu;
    }
  });

  it("biến mới thêm vào process.env tự động nằm NGOÀI - đó là điểm của danh sách cho phép", () => {
    const cu = { ...process.env };
    process.env.MOT_BI_MAT_MOI_TINH_NAM_2027 = "x";
    try {
      assert.equal(mod.envToiThieu().MOT_BI_MAT_MOI_TINH_NAM_2027, undefined);
    } finally {
      process.env = cu;
    }
  });

  it("VẪN chở đủ thứ yt-dlp cần chạy", () => {
    const ra = mod.envToiThieu();
    assert.equal(ra.PYTHONIOENCODING, "utf-8", "thiếu là Python trên Windows ném khi in tiêu đề có dấu");
    // PATH là biến duy nhất chắc chắn có trên mọi hệ - kiểm nó đi qua được.
    assert.ok(ra.PATH !== undefined || ra.Path !== undefined, "không có PATH thì không tìm nổi python");
  });

  it("chở biến proxy - VPS siết egress thì thiếu nhóm này là yt-dlp không ra được mạng", () => {
    const cu = { ...process.env };
    process.env.HTTPS_PROXY = "http://proxy.noi-bo:3128";
    process.env.NO_PROXY = "localhost";
    try {
      const ra = mod.envToiThieu();
      assert.equal(ra.HTTPS_PROXY, "http://proxy.noi-bo:3128");
      assert.equal(ra.NO_PROXY, "localhost");
    } finally {
      process.env = cu;
    }
  });
});

describe("dungLoiGoi - ba lớp siết PHẢI có mặt trong lời gọi thật", () => {
  /**
   * Đo được trước khi có nhóm ca này: bỏ hẳn `CO_AN_TOAN` khỏi dòng lệnh, hoặc
   * đổi `env: envToiThieu()` thành `env: process.env`, thì CẢ 2389 ca test vẫn
   * xanh. Tức ba lớp siết được mô tả rất kỹ trong chú thích mà không có gì canh.
   *
   * Lớp phòng thủ không có test là lớp sẽ bị "dọn dẹp" mất.
   */
  it("`--ignore-config` và `--no-plugin-dirs` LUÔN có mặt", () => {
    // Không có `--ignore-config` thì một `yt-dlp.conf` đặt được `--exec`, tức
    // chạy lệnh tùy ý - đã đo hai chiều là có thật. `--no-plugin-dirs` chặn
    // plugin, vốn là mã Python chạy trong chính tiến trình này.
    const lenh = mod.dungLoiGoi(["--dump-single-json", "https://x"]);
    assert.ok(lenh.doiSo.includes("--ignore-config"), "thiếu là mở đường chạy lệnh tùy ý");
    assert.ok(lenh.doiSo.includes("--no-plugin-dirs"), "thiếu là mở đường nạp mã Python");
  });

  it("hai cờ đó đứng TRƯỚC đối số của caller", () => {
    // Đứng sau thì caller chèn được thứ gì đó vào trước chúng.
    const lenh = mod.dungLoiGoi(["--dump-single-json", "https://x"]);
    const iCo = lenh.doiSo.indexOf("--ignore-config");
    const iCuaCaller = lenh.doiSo.indexOf("--dump-single-json");
    assert.ok(iCo >= 0 && iCuaCaller > iCo, `thứ tự sai: ${lenh.doiSo.join(" ")}`);
  });

  it("đối số của caller được giữ nguyên, đúng thứ tự", () => {
    const lenh = mod.dungLoiGoi(["-f", "bv*+ba", "https://x"]);
    const duoi = lenh.doiSo.slice(-3);
    assert.deepEqual(duoi, ["-f", "bv*+ba", "https://x"]);
  });

  it("env đưa vào tiến trình là env ĐÃ LỌC, KHÔNG phải process.env", () => {
    // Đây là ca quan trọng nhất file này: `envToiThieu` được test kỹ như một
    // hàm, nhưng việc nó có được DÙNG hay không thì trước đây không ai đo.
    const cu = { ...process.env };
    process.env.CREDENTIALS_ENCRYPTION_KEY = "bi-mat-khong-duoc-lo";
    process.env.LLM_API_KEY = "sk-bi-mat";
    try {
      const lenh = mod.dungLoiGoi(["--version"]);
      assert.equal(lenh.env.CREDENTIALS_ENCRYPTION_KEY, undefined, "khóa giải mã cookie Zalo bị lộ");
      assert.equal(lenh.env.LLM_API_KEY, undefined);
      assert.equal(lenh.env.PYTHONIOENCODING, "utf-8", "vẫn phải là env do envToiThieu dựng");
    } finally {
      process.env = cu;
    }
  });
});

describe("chayYtDlp - chạy thật với binary không tồn tại", () => {
  it("báo ĐÚNG BỆNH kèm cờ loiCauHinh, KHÔNG đổ cho video", async () => {
    const ket = await mod.chayYtDlp(["--version"], 20_000);

    assert.equal(ket.ok, false);
    assert.ok(!ket.ok && ket.loiCauHinh === true, "thiếu cờ này là tool nói 'video có thể ở chế độ riêng tư'");
    assert.match((ket as { loi: string }).loi, /yt-dlp/, "câu lỗi phải gọi tên thứ cần cài");
  });
});
