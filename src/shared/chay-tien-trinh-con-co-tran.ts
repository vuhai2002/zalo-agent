import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { docRssTuProc } from "./doc-rss-tien-trinh.js";
import type { ThongDiepCon } from "./phuc-vu-tien-trinh-con.js";
import { coNodeChoCon, dongLoiTrongStderr, envToiThieuChoCon } from "./tien-trinh-con-moi-truong.js";

export { phucVuTienTrinhCon } from "./phuc-vu-tien-trinh-con.js";

/**
 * Chạy một việc nguy hiểm (đọc tài liệu do người lạ gửi) trong TIẾN TRÌNH CON
 * có trần thời gian và trần RSS. Vì sao không worker thread: PoC - PDF 128 KB
 * bom Flate phình 385 MB ArrayBuffer NGOÀI heap (worker `resourceLimits` không
 * thấy), và V8 vượt heap trong worker có lúc `abort()` CẢ tiến trình. Con thì
 * SIGKILL luôn an toàn, RSS đo được từ ngoài.
 *
 * Module THUẦN (không env/DB/logger) - script con và mọi thứ nó import cũng
 * vậy: con chạy với env tối thiểu, import `config/env.ts` là chết lúc nạp.
 */

export type TranTienTrinhCon = {
  /** Trần thời gian tổng, tính từ lúc fork */
  hanMs: number;
  /** Trần RSS của con (MB) - bắt cả bộ nhớ ngoài heap */
  tranRssMb: number;
  /** `--max-old-space-size` của con (MB) */
  tranHeapMb: number;
};

export type LyDoNgat = "het-gio" | "vuot-ram" | "chet-bat-thuong";

/** Con bị buộc dừng giữa chừng - KHÔNG biết tài liệu hỏng thật hay máy chậm */
export class LoiTienTrinhConBiNgat extends Error {
  constructor(
    readonly lyDo: LyDoNgat,
    message: string,
  ) {
    super(message);
    this.name = "LoiTienTrinhConBiNgat";
  }
}

/**
 * Lỗi do CHÍNH con báo về (file hỏng, có mật khẩu...). Mang `ma` có kiểu để
 * caller rẽ nhánh bằng mã, không bằng so chữ.
 */
export class LoiTuTienTrinhCon extends Error {
  constructor(
    readonly ma: string,
    message: string,
  ) {
    super(message);
    this.name = "LoiTuTienTrinhCon";
  }
}

const NHIP_DO_RSS_MS = 25;
const GIU_STDERR_BYTE = 2048;

/**
 * Đường dẫn script con cùng đuôi với module gọi: dev chạy nguồn `.ts` qua
 * tsx, prod chạy `dist/*.js`. `tenGoc` không kèm đuôi, tương đối với module gọi.
 */
export function urlScriptCon(tenGoc: string, importMetaUrl: string): URL {
  const duoi = importMetaUrl.endsWith(".ts") ? ".ts" : ".js";
  return new URL(`${tenGoc}${duoi}`, importMetaUrl);
}

export function chayTienTrinhCon<V, R>(p: {
  script: URL;
  duLieu: V;
  tran: TranTienTrinhCon;
  /** Tiêm cho test; mặc định đọc `/proc` (null ngoài Linux -> dùng số con tự báo) */
  docRssMb?: (pid: number) => number | null;
  /**
   * Gọi (tối đa một lần mỗi lượt chạy) khi đang trên Linux mà KHÔNG đọc được
   * `/proc` của con - lúc đó cầu dao RSS lùi về số con tự báo, mà số đó câm
   * đúng lúc con đang giải nén đồng bộ. Module này thuần (không logger) nên
   * caller tự log.
   */
  baoKhongDoDuocRss?: () => void;
}): Promise<R> {
  const docRss = p.docRssMb ?? docRssTuProc;
  return new Promise<R>((resolve, reject) => {
    const con = fork(fileURLToPath(p.script), [], {
      execArgv: coNodeChoCon(p.tran.tranHeapMb),
      env: envToiThieuChoCon(),
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });

    let stderrDuoi = "";
    con.stderr?.on("data", (d: Buffer) => {
      stderrDuoi = (stderrDuoi + d.toString("utf-8")).slice(-GIU_STDERR_BYTE);
    });

    let daXong = false;
    let rssConTuBao = 0;
    let daBaoKhongDo = false;

    const ketThuc = (fn: () => void) => {
      if (daXong) return;
      daXong = true;
      clearTimeout(hetHan);
      clearInterval(doRss);
      if (con.exitCode === null && con.signalCode === null) con.kill("SIGKILL");
      fn();
    };

    const hetHan = setTimeout(() => {
      ketThuc(() =>
        reject(new LoiTienTrinhConBiNgat("het-gio", `Tiến trình đọc tài liệu quá thời gian cho phép (${p.tran.hanMs}ms)`)),
      );
    }, p.tran.hanMs);
    hetHan.unref();

    const doRss = setInterval(() => {
      if (con.pid === undefined) return;
      const rssNgoai = docRss(con.pid);
      if (rssNgoai === null && process.platform === "linux" && !daBaoKhongDo && con.exitCode === null) {
        daBaoKhongDo = true;
        p.baoKhongDoDuocRss?.();
      }
      const rss = rssNgoai ?? rssConTuBao;
      if (rss > p.tran.tranRssMb) {
        ketThuc(() =>
          reject(
            new LoiTienTrinhConBiNgat(
              "vuot-ram",
              `Tiến trình đọc tài liệu vượt trần bộ nhớ (${Math.round(rss)} MB > ${p.tran.tranRssMb} MB)`,
            ),
          ),
        );
      }
    }, NHIP_DO_RSS_MS);
    doRss.unref();

    con.on("message", (msg: ThongDiepCon) => {
      if ("rssMb" in msg) {
        rssConTuBao = msg.rssMb;
        return;
      }
      if (msg.ok) ketThuc(() => resolve(msg.ketQua as R));
      else ketThuc(() => reject(new LoiTuTienTrinhCon(msg.ma, msg.loi)));
    });

    con.once("error", (err) => {
      ketThuc(() => reject(new LoiTienTrinhConBiNgat("chet-bat-thuong", `Không chạy được tiến trình con: ${err.message}`)));
    });

    // `close`, KHÔNG `exit`: Node không hứa `exit` tới SAU tin IPC cuối cùng -
    // con gửi kết quả rồi thoát ngay, cha mà xử lý `exit` trước là báo nhầm
    // lượt thành công thành "thoát bất thường". `close` chờ cả kênh IPC lẫn
    // stderr đóng (nên đuôi stderr cũng đủ hơn). Treo mãi không đóng thì hạn
    // giờ vẫn bắn.
    con.once("close", (code, signal) => {
      const lyDo = dongLoiTrongStderr(stderrDuoi);
      const duoi = lyDo ? ` - ${lyDo}` : "";
      ketThuc(() =>
        reject(
          new LoiTienTrinhConBiNgat(
            "chet-bat-thuong",
            `Tiến trình đọc tài liệu thoát bất thường (mã ${code ?? signal}) mà không trả kết quả${duoi}`,
          ),
        ),
      );
    });

    con.send({ duLieu: p.duLieu });
  });
}
