import { renderPageAsImage } from "unpdf";
import { moPdf } from "../knowledge/extract-pdf-text.js";

/**
 * Render các trang PDF thành JPEG để model đọc ảnh chép chữ (OCR). CHỈ chạy
 * trong tiến trình con (`pdf-render-child.ts`): maintainer `@napi-rs/canvas`
 * khuyên rõ không dùng trong worker thread, và một crash native ở đây không
 * được phép kéo chết bot.
 *
 * Mỗi lúc một trang, `cleanup()` ngay sau trang đó - ảnh quét 300 dpi giải mã
 * ra ~35 MB RGBA, giữ nhiều trang cùng lúc là chạm trần RSS.
 */

export type AnhTrang = { so: number; jpeg: Uint8Array };

/** Trần điểm ảnh khi render OCR - xem `moPdf`; A4 quét 600 dpi ~35 MP */
const TRAN_ANH_DIEM_RENDER = 64 * 1024 * 1024;

export async function renderTrangJpeg(
  buf: Buffer,
  soTrang: number[],
  p: { canhDaiPx: number; chatLuong: number },
): Promise<AnhTrang[]> {
  const pdf = await moPdf(buf, TRAN_ANH_DIEM_RENDER);
  try {
    const ra: AnhTrang[] = [];
    for (const so of soTrang) {
      if (!Number.isInteger(so) || so < 1 || so > pdf.numPages) continue;
      const page = await pdf.getPage(so);
      try {
        const vp = page.getViewport({ scale: 1 });
        const scale = p.canhDaiPx / Math.max(vp.width, vp.height);
        const jpeg = await renderPageAsImage(pdf, so, {
          canvasImport: () => import("@napi-rs/canvas"),
          scale,
          format: "jpeg",
          quality: p.chatLuong,
        });
        // Không truyền `toDataURL` nên unpdf trả byte, không bao giờ trả chuỗi
        if (typeof jpeg === "string") throw new Error("unpdf trả data URL thay vì byte ảnh");
        ra.push({ so, jpeg: new Uint8Array(jpeg) });
      } finally {
        page.cleanup();
      }
    }
    return ra;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
