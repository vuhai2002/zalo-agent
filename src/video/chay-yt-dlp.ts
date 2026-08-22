/**
 * MỘT chỗ duy nhất biết cách chạy tiến trình yt-dlp cho an toàn.
 *
 * Có hai đường dùng yt-dlp: đọc metadata (`nguon-yt-dlp.ts`) và tải hẳn file về
 * (`tai-bang-yt-dlp.ts`). Nếu mỗi bên tự gọi `execFile` thì lớp siết bảo mật
 * nằm ở hai nơi, và cái bị quên khi sửa luôn là cái ít người đọc hơn - đúng bài
 * học đã ghi cho `openGuardedRequest`.
 *
 * Ba lớp siết, đều có lý do đo được:
 *
 * 1. `envToiThieu` - DANH SÁCH CHO PHÉP biến môi trường. Tiến trình này phân
 *    tích nội dung của một URL do NGƯỜI LẠ gửi, nên nó không có việc gì nhìn
 *    thấy `CREDENTIALS_ENCRYPTION_KEY` hay khóa API router. Danh sách CHO PHÉP
 *    (không phải danh sách cấm) để biến bí mật thêm sau này tự động nằm ngoài.
 *
 * 2. `--ignore-config` - bỏ mọi file cấu hình (`yt-dlp.conf` ở thư mục làm
 *    việc, thư mục nhà, /etc). File đó đặt được `--exec`, tức chạy lệnh tùy ý.
 *    Đã kiểm hai chiều: đặt config rác vào thư mục làm việc rồi chạy KHÔNG cờ
 *    thì yt-dlp báo `no such option` (tức nó CÓ đọc); chạy CÓ cờ thì bỏ qua sạch.
 *
 * 3. `--no-plugin-dirs` - không nạp plugin. Plugin là mã Python chạy trong
 *    chính tiến trình này. Đã kiểm: `Plugin directories: none (disabled)`.
 *
 * Cả (2) và (3) là đường leo thang từ "ghi được một file" lên "chạy được lệnh",
 * mà bot thì có tool ghi file.
 */

import { execFile } from "node:child_process";

import { env } from "../config/env.js";

/** Trần chữ đọc từ stdout - JSON của yt-dlp có thể vài trăm KB với video nhiều format */
const TRAN_STDOUT = 8 * 1024 * 1024;

/**
 * Cờ bắt buộc cho MỌI lời gọi yt-dlp. Xem khối chú thích đầu file.
 *
 * Đứng đầu dòng lệnh, trước mọi đối số của caller, để không ai vô tình chèn
 * được thứ gì vào trước chúng.
 */
const CO_AN_TOAN = ["--ignore-config", "--no-plugin-dirs"] as const;

/**
 * Câu lỗi riêng cho ca THIẾU CÔNG CỤ - phải khác hẳn lỗi về video.
 *
 * Chuỗi này đi vào câu tool trả cho model, nên nó phải đủ để người vận hành
 * biết sửa ở đâu mà không cần mở log.
 */
export const LOI_THIEU_YTDLP =
  "Máy chủ chưa cài yt-dlp nên không đọc được video này (Facebook cần nó, TikTok mất tầng dự phòng). " +
  "Đây là thiếu sót cấu hình máy chủ, KHÔNG phải video có vấn đề - nói đúng như vậy với người dùng.";

/**
 * Biến môi trường CHO PHÉP đi vào tiến trình yt-dlp.
 *
 * Từng cái đều cần thật:
 *   PATH/Path        - tìm ra chính python (Windows dùng `Path`)
 *   SystemRoot       - Python trên Windows KHÔNG khởi động nổi nếu thiếu
 *   TEMP/TMP/TMPDIR  - chỗ ghi file tạm
 *   HOME/USERPROFILE - yt-dlp tìm thư mục cache ở đây
 *   APPDATA          - ĐO THẬT trên máy dev: thiếu nó thì Python bỏ luôn thư mục
 *                      user site-packages, bản cài bằng `pip install --user`
 *                      biến mất và báo `No module named yt_dlp` y hệt ca chưa
 *                      cài. Docker cài toàn hệ thống nên không dính, nhưng
 *                      triệu chứng thì trỏ sai hoàn toàn.
 *   LOCALAPPDATA / XDG_CACHE_HOME - thư mục cache
 *   LANG/LC_ALL      - tránh lỗi mã hóa khi in tiêu đề có dấu
 *   *_PROXY/NO_PROXY - VPS có tường lửa egress thường bắt đi qua proxy; thiếu
 *                      nhóm này thì yt-dlp không ra được mạng ở đúng môi trường
 *                      được siết chặt nhất. Đây là URL cấu hình, không phải bí mật.
 *
 * CỐ Ý KHÔNG cho `PYTHONPATH` và `PYTHONSTARTUP` qua: cả hai đều nạp mã Python
 * vào tiến trình này, nên chúng là đúng thứ danh sách cho phép sinh ra để chặn.
 * (`PYTHON_PATH` của dự án chỉ khác `PYTHONPATH` một gạch dưới - đừng đọc nhầm.)
 */
const ENV_CHO_PHEP = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CACHE_HOME",
  "LANG",
  "LC_ALL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export function envToiThieu(): NodeJS.ProcessEnv {
  const ra: NodeJS.ProcessEnv = {
    // Ép UTF-8: tiêu đề video TikTok/Facebook đầy emoji và chữ có dấu, mà
    // Python trên Windows mặc định cp1252 sẽ NÉM khi in ra.
    PYTHONIOENCODING: "utf-8",
  };
  for (const ten of ENV_CHO_PHEP) {
    const v = process.env[ten];
    if (v !== undefined) ra[ten] = v;
  }
  return ra;
}

/** Đường chạy yt-dlp. Cho đổi qua cấu hình vì Docker và máy dev đặt khác nhau. */
function lenhYtDlp(): { file: string; dauVao: string[] } {
  const tuEnv = env.YTDLP_PATH?.trim();
  if (tuEnv) return { file: tuEnv, dauVao: [] };
  // `python -m yt_dlp` chạy được cả khi không có binary `yt-dlp` trong PATH -
  // đó là ca của bản cài bằng pip trong image Docker.
  return { file: env.PYTHON_PATH?.trim() || "python", dauVao: ["-m", "yt_dlp"] };
}

export type KetQuaChayYtDlp =
  | { ok: true; stdout: string }
  | { ok: false; loi: string; loiCauHinh?: boolean };

/**
 * yt-dlp CÓ trên máy nhưng chạy hỏng vì THIẾU CÔNG CỤ chứ không phải vì video?
 *
 * Hai hình dạng, và ca thứ hai mới là ca Docker thật:
 *
 *   - `ENOENT`: thiếu chính binary (`python3` / `yt-dlp`). Trên Docker thì
 *     `apk add python3` đảm bảo có, nên ca này gần như chỉ gặp ở máy dev.
 *   - Thoát mã 1 kèm stderr `No module named yt_dlp`: có `python3` nhưng KHÔNG
 *     có module. Đây mới là ca production (pip install hỏng, đổi base image,
 *     gỡ nhầm gói). ĐO THẬT: `err.code === 1`, KHÔNG phải "ENOENT" - nên nhánh
 *     chỉ bắt ENOENT bỏ lọt đúng ca cần bắt nhất, và model lại nhận câu "video
 *     có thể ở chế độ riêng tư".
 */
export function laLoiThieuCongCu(err: NodeJS.ErrnoException, stderr: string): boolean {
  if (err.code === "ENOENT") return true;
  return /No module named ['"]?yt[_-]?dlp/i.test(stderr);
}

/**
 * Chạy yt-dlp với đối số của caller. KHÔNG ném - mọi nhánh hỏng trả `{ok:false}`.
 *
 * `execFile` truyền đối số dạng MẢNG (không qua shell) nên không có chỗ cho
 * tiêm lệnh; và URL đi vào đây đã qua whitelist nên không thể là chuỗi bắt đầu
 * bằng `-` để bị hiểu thành cờ.
 */
/**
 * Dựng lời gọi cuối cùng. Hàm THUẦN, tách ra để test được.
 *
 * Không tách thì ba lớp siết bảo mật của file này KHÔNG có gì canh: đo được là
 * bỏ hẳn `CO_AN_TOAN` khỏi dòng lệnh, hoặc đổi `envToiThieu()` thành
 * `process.env`, thì cả 2389 ca test vẫn xanh. `envToiThieu` được test rất kỹ
 * NHƯ MỘT HÀM, nhưng "nó có được DÙNG không" thì không ai đo - mà xóa đúng một
 * chữ ở đó là `CREDENTIALS_ENCRYPTION_KEY` chảy vào tiến trình đang phân tích
 * URL của người lạ.
 */
export function dungLoiGoi(doiSo: string[]): {
  file: string;
  doiSo: string[];
  env: NodeJS.ProcessEnv;
} {
  const { file, dauVao } = lenhYtDlp();
  // `CO_AN_TOAN` đứng TRƯỚC đối số của caller: không ai chèn được gì vào trước chúng.
  return { file, doiSo: [...dauVao, ...CO_AN_TOAN, ...doiSo], env: envToiThieu() };
}

export function chayYtDlp(doiSo: string[], tranMs: number): Promise<KetQuaChayYtDlp> {
  const lenh = dungLoiGoi(doiSo);
  return new Promise((resolve) => {
    execFile(
      lenh.file,
      lenh.doiSo,
      { timeout: tranMs, maxBuffer: TRAN_STDOUT, env: lenh.env, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          if (laLoiThieuCongCu(err as NodeJS.ErrnoException, stderr || "")) {
            resolve({ ok: false, loi: LOI_THIEU_YTDLP, loiCauHinh: true });
            return;
          }
          // Tiến trình bị GIẾT vì quá hạn: `err.message` chỉ ghi "Command
          // failed", không có chữ "timed out" nào để mà nhận ra. Dấu hiệu thật
          // là `killed` cộng `signal`. Không dựng lại được từ chữ.
          // `killed` bật ở HAI ca: hết giờ, và tràn `maxBuffer`. Phân biệt bằng
          // `signal` - hết giờ thì `execFile` gửi SIGTERM, tràn buffer thì
          // không. Gộp hai ca là báo "quá 300000ms" cho một lỗi chẳng liên quan
          // tới thời gian, dắt người debug đi sai hướng.
          const eb = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          if (eb.killed) {
            resolve({
              ok: false,
              loi: eb.signal ? `yt-dlp quá ${tranMs}ms, đã dừng` : "yt-dlp in ra quá nhiều, đã dừng",
            });
            return;
          }
          const doanLoi = (stderr || "").split("\n").find((d) => d.startsWith("ERROR:")) ?? err.message;
          resolve({ ok: false, loi: doanLoi.slice(0, 300) });
          return;
        }
        resolve({ ok: true, stdout });
      },
    );
  });
}
