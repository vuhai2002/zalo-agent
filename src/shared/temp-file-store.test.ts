import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "./test-env-setup.js";

let dataDir: string;
let store: typeof import("./temp-file-store.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./temp-file-store.js");
});

after(() => cleanupTestEnv(dataDir));

const tmpDir = () => path.join(dataDir, "tmp");

describe("temp-file-store", () => {
  it("ghi file tạm rồi xóa sau khi dùng xong", async () => {
    let seenPath = "";
    const result = await store.withTempFile("bao-gia.pdf", Buffer.from("noi dung"), async (p) => {
      seenPath = p;
      assert.ok(fs.existsSync(p), "file phải tồn tại trong lúc dùng");
      assert.equal(fs.readFileSync(p, "utf-8"), "noi dung");
      return "da-gui";
    });

    assert.equal(result, "da-gui");
    assert.equal(fs.existsSync(seenPath), false, "file phải bị xóa sau khi dùng");
    assert.ok(seenPath.endsWith("-bao-gia.pdf"), "giữ tên gốc để người nhận đọc được");
  });

  it("gửi lỗi thì vẫn xóa file (không để rác lại)", async () => {
    let seenPath = "";
    await assert.rejects(() =>
      store.withTempFile("x.zip", Buffer.from("abc"), async (p) => {
        seenPath = p;
        throw new Error("gửi thất bại");
      }),
    );
    assert.equal(fs.existsSync(seenPath), false);
  });

  it("tên file chỉ lấy basename - không thoát khỏi data/tmp", async () => {
    let seenPath = "";
    await store.withTempFile("../../thoat.txt", Buffer.from("x"), async (p) => {
      seenPath = p;
    });
    assert.equal(path.dirname(seenPath), tmpDir());
  });

  it("2 lượt gửi cùng tên file không đè nhau", async () => {
    const paths: string[] = [];
    const hold = (p: string) =>
      new Promise<void>((resolve) => {
        paths.push(p);
        setTimeout(resolve, 20);
      });
    await Promise.all([
      store.withTempFile("cung-ten.pdf", Buffer.from("a"), hold),
      store.withTempFile("cung-ten.pdf", Buffer.from("b"), hold),
    ]);
    assert.notEqual(paths[0], paths[1]);
  });

  it("cleanup xóa file mồ côi cũ, giữ file mới", () => {
    fs.mkdirSync(tmpDir(), { recursive: true });
    const oldFile = path.join(tmpDir(), "mo-coi.bin");
    const newFile = path.join(tmpDir(), "vua-tao.bin");
    fs.writeFileSync(oldFile, "cu");
    fs.writeFileSync(newFile, "moi");
    const longAgo = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8h
    fs.utimesSync(oldFile, longAgo, longAgo);

    const removed = store.cleanupOrphanTempFiles();

    assert.equal(removed, 1);
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(newFile), true);
  });

  it("chưa có thư mục tmp thì cleanup trả 0, không throw", () => {
    fs.rmSync(tmpDir(), { recursive: true, force: true });
    assert.equal(store.cleanupOrphanTempFiles(), 0);
  });
});

describe("withEmptyTempFile - đưa chỗ trống để ghi thẳng vào", () => {
  it("đưa đường dẫn TRONG thư mục tạm và file CHƯA tồn tại", async () => {
    let p = "";
    await store.withEmptyTempFile("video.mp4", async (duongDan) => {
      p = duongDan;
      assert.equal(path.dirname(duongDan), tmpDir());
      assert.equal(fs.existsSync(duongDan), false, "phải là chỗ trống, không phải file rỗng đã tạo sẵn");
      fs.writeFileSync(duongDan, "abc");
      return null;
    });
    assert.equal(fs.existsSync(p), false);
  });

  it("XÓA file kể cả khi việc bên trong NÉM", async () => {
    let p = "";
    await assert.rejects(
      () =>
        store.withEmptyTempFile("video.mp4", async (duongDan) => {
          p = duongDan;
          fs.writeFileSync(duongDan, "tai dang do");
          throw new Error("Zalo từ chối");
        }),
      /Zalo từ chối/,
    );

    // Đây là ca đáng lo nhất: tải video 40 MB xong thì gửi hỏng. Không xóa ở
    // nhánh này là mỗi lần gửi hỏng để lại một file trên đĩa VPS.
    assert.equal(fs.existsSync(p), false, "gửi hỏng mà giữ file lại là đầy đĩa dần");
  });

  it("tên file có ../ KHÔNG thoát ra khỏi thư mục tạm", async () => {
    // Tên suy từ dữ liệu của bên thứ ba (tác giả video), nên đây là đường vào
    // ghi đè file bất kỳ trên máy chủ.
    let p = "";
    await store.withEmptyTempFile("../../../etc/passwd", async (duongDan) => {
      p = duongDan;
      return null;
    });
    assert.equal(path.dirname(p), tmpDir(), `thoát ra ngoài: ${p}`);
    assert.doesNotMatch(p, /\.\./);
  });

  it("hai lời gọi cùng tên vẫn ra hai đường dẫn khác nhau", async () => {
    // Hai người cùng gửi link một lúc: trùng đường dẫn là hai lượt ghi đè nhau
    // rồi cùng gửi một file.
    let a = "";
    let b = "";
    await store.withEmptyTempFile("video.mp4", async (x) => {
      a = x;
      return null;
    });
    await store.withEmptyTempFile("video.mp4", async (x) => {
      b = x;
      return null;
    });
    assert.notEqual(a, b);
  });

  it("trả về đúng giá trị của việc bên trong", async () => {
    const ra = await store.withEmptyTempFile("v.mp4", async () => 12_345);
    assert.equal(ra, 12_345);
  });
});

describe("chặn thoát thư mục tạm - cả ba hàm cùng một bất biến", () => {
  /**
   * Tên file ở cả ba hàm đều đến từ chỗ ta không kiểm soát: model tự đặt tên
   * cho `send_file` và hai tool tài liệu, còn `withEmptyTempFile` suy tên từ
   * tác giả video của bên thứ ba. `path.basename` là thứ duy nhất đứng giữa cái
   * tên đó và một lời ghi đè file bất kỳ trên máy chủ.
   *
   * Hai hàm đầu đã có cửa chặn từ trước nhưng KHÔNG có test - phép phá cho thấy
   * bỏ `path.basename` ở đó thì cả bộ vẫn xanh.
   */
  const TEN_XAU = "../../../etc/passwd";

  it("withTempFile giữ file trong thư mục tạm", async () => {
    let p = "";
    await store.withTempFile(TEN_XAU, Buffer.from("x"), async (duongDan) => {
      p = duongDan;
      return null;
    });
    assert.equal(path.dirname(p), tmpDir(), `thoát ra ngoài: ${p}`);
  });

  it("withNamedTempFile giữ file trong thư mục con của thư mục tạm", async () => {
    let p = "";
    await store.withNamedTempFile(TEN_XAU, Buffer.from("x"), async (duongDan) => {
      p = duongDan;
      return null;
    });
    // Hàm này cố ý giữ NGUYÊN tên (để người nhận thấy đúng tên file), nên nó
    // đặt file trong một thư mục con random - thư mục con đó vẫn phải nằm trong
    // thư mục tạm.
    assert.equal(path.dirname(path.dirname(p)), tmpDir(), `thoát ra ngoài: ${p}`);
    assert.equal(path.basename(p), "passwd");
  });
});
