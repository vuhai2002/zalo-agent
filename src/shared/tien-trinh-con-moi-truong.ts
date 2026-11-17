/** Dựng môi trường chạy cho tiến trình con của `chay-tien-trinh-con-co-tran.ts` - module thuần. */

/**
 * Cờ Node được mang sang con: chỉ loader (để tsx dịch được `.ts` ở dev) và vài
 * cờ vô hại. Lọc theo danh sách CHO PHÉP vì `process.execArgv` của tiến trình
 * test có `--test*` - mang sang là con tự biến thành test runner.
 */
export function coNodeChoCon(tranHeapMb: number): string[] {
  const giu: string[] = [];
  const goc = process.execArgv;
  for (let i = 0; i < goc.length; i++) {
    const co = goc[i]!;
    const ten = co.split("=")[0]!;
    if (["--import", "--require", "-r", "--loader", "--experimental-loader"].includes(ten)) {
      giu.push(co);
      if (!co.includes("=") && i + 1 < goc.length) giu.push(goc[++i]!);
    } else if (ten === "--enable-source-maps" || ten === "--no-warnings" || ten.startsWith("--conditions")) {
      giu.push(co);
    }
  }
  giu.push(`--max-old-space-size=${tranHeapMb}`);
  return giu;
}

/**
 * Dòng nói LÝ DO chết trong đuôi stderr. V8 OOM in "FATAL ERROR: ... heap out
 * of memory" rồi mới in một tràng stack frame địa chỉ máy - lấy hai dòng cuối
 * là chỉ còn địa chỉ, mất đúng dòng cần để chẩn đoán.
 */
export function dongLoiTrongStderr(stderr: string): string {
  const dong = stderr
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);
  const loi = dong.filter((d) => /FATAL ERROR|out of memory|Error\b/i.test(d));
  return (loi.length > 0 ? loi.slice(-2) : dong.slice(-2)).join(" | ");
}

/** Env tối thiểu: con đọc dữ liệu người lạ, không có việc gì phải thấy khóa bí mật */
export function envToiThieuChoCon(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const k of ["PATH", "Path", "SystemRoot", "TEMP", "TMP"]) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}
