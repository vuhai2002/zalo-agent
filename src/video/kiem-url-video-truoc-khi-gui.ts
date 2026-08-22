/**
 * Dò xem đường dẫn video do NGUỒN trả về có thật sự gửi được không.
 *
 * VÌ SAO PHẢI CÓ - đây là lỗi đã trả giá, đừng gỡ đi:
 *
 * Bản trước giả định "URL hỏng thì `sendVideo` sẽ ném, ta bắt lại rồi lùi sang
 * đường tải về". Giả định đó SAI. Đọc source zca-js (`sendVideo.ts:69-77`):
 *
 *     const headResponse = await utils.request(options.videoUrl, { method: "HEAD" }, true);
 *     if (headResponse.ok) { fileSize = parseInt(...); }
 *
 * `sendVideo` chỉ NÉM khi bản thân request HEAD ném (lỗi mạng, DNS). HTTP 403
 * hay 404 thì `headResponse.ok` là `false`, `fileSize` giữ 0, và nó VẪN gửi tin
 * nhắn chứa cái URL chết đó. Nghĩa là nhánh `catch` không bao giờ chạy, đường
 * tải-về là code chết, còn bot thì trừ suất, ghi lịch sử "đã gửi video" và báo
 * model thành công - trong khi người nhận thấy một thẻ video không mở được.
 *
 * Đo thật trên link TikTok: URL của yt-dlp trả **403 ngay trên chính máy vừa
 * chạy yt-dlp** (nó gắn với phiên của yt-dlp). Đó không phải ca hiếm.
 *
 * DÒ BẰNG GET KÈM `Range: bytes=0-0`, KHÔNG bằng HEAD - đã đo và trả giá:
 * `v16m.tiktokcdn-us.com` trả **503 cho HEAD** trong khi trả **206 cho GET kèm
 * Range** trên CÙNG một URL, còn `v19.tiktokcdn-us.com` thì trả lời HEAD bình
 * thường. Tức HEAD hỏng KHÔNG có nghĩa video hỏng: máy người nhận tải bằng GET
 * và vẫn xem được. Dò bằng HEAD là đẩy oan video sống sang đường dự phòng đắt
 * nhất. Range 0-0 chỉ tốn một byte mà đo đúng thứ sẽ xảy ra thật.
 *
 * BẢO MẬT: đi qua `openGuardedRequest` nên `videoUrl` - vốn là chuỗi do bên thứ
 * ba (TikWM/yt-dlp) trả về - bị chặn nếu trỏ vào địa chỉ nội bộ, và mỗi hop
 * chuyển hướng đều bị kiểm lại. Không có bước này thì `videoUrl` đi thẳng vào
 * `sendVideo`, mà zca-js đi theo `location` ĐỆ QUY không đếm hop, không kiểm
 * địa chỉ (`utils.ts:320-331`).
 */

import { MAX_REDIRECTS, openGuardedRequest } from "../shared/safe-remote-download.js";

/** Trần thời gian cho một lượt dò. Chỉ xin 1 byte nên không cần rộng. */
const TRAN_DO_MS = 15_000;

/**
 * Số hop chuyển hướng tối đa khi dò.
 *
 * IMPORT chứ không chép tay: bản trước ghi `3` kèm chú thích "giữ bằng bản tải
 * để hai bên cùng luật" - một lời hứa không ai canh. Import thì trình biên dịch
 * canh hộ.
 */
const TRAN_HOP = MAX_REDIRECTS;

/**
 * Hai host có cùng "họ" tên miền không (so hai nhãn cuối).
 *
 * Đủ cho việc cần làm: phân biệt một bước định tuyến CDN thường lệ
 * (`video.fsgn2-6.fna.fbcdn.net` -> `video.xx.fbcdn.net`) với việc bị dắt sang
 * một nơi khác hẳn. KHÔNG cần bảng eTLD đầy đủ vì đây KHÔNG phải cửa bảo mật -
 * cửa bảo mật là `openGuardedRequest`, vốn kiểm địa chỉ ở TỪNG hop bất kể tên
 * miền là gì; hàm này chỉ chọn đường đi cho rẻ.
 */
export function cungHo(a: string, b: string): boolean {
  if (a === b) return true;
  const hai = (h: string) => h.toLowerCase().split(".").slice(-2).join(".");
  return hai(a) === hai(b);
}

/**
 * Cỡ THẬT của cả file, từ header nào nói đúng.
 *
 * Với 206 thì `content-length` là độ dài của PHẦN vừa xin (1 byte) chứ không
 * phải cỡ file - đọc nhầm nó là mọi video đều "1 byte", và trần dung lượng
 * thành vô nghĩa. Cỡ thật nằm ở đuôi `content-range: bytes 0-0/6667679`.
 *
 * Máy chủ không hỗ trợ Range thì trả 200 kèm `content-length` là cỡ đầy đủ.
 * Không có gì đáng tin thì trả `null` - thà không biết còn hơn biết sai.
 */
export function doCoThat(status: number, dayDu: string | undefined, daiPhan: number): number | null {
  if (status === 206) {
    const m = /\/(\d+)\s*$/.exec(dayDu ?? "");
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return Number.isFinite(daiPhan) && daiPhan > 0 ? daiPhan : null;
}

export type KetQuaDo =
  | {
      ok: true;
      soByte: number | null;
      kieuNoiDung: string;
      /**
       * URL CUỐI CÙNG đã được xác thực (sau khi đi hết chuyển hướng).
       *
       * Caller PHẢI dùng cái này, không dùng chuỗi gốc: bản trước dò một đằng
       * rồi đưa `sendVideo` một nẻo, mà zca-js đi theo `location` đệ quy không
       * đếm hop và không kiểm địa chỉ.
       */
      urlCuoi: string;
      /**
       * Chuyển hướng có RỜI KHỎI họ tên miền ban đầu không.
       *
       * Chỉ ca này mới đáng đi đường TỰ TẢI. Bản đầu đánh dấu MỌI chuyển hướng
       * và đo ra là quá chặt: fbcdn trả `302` từ `video.fsgn2-6.fna.fbcdn.net`
       * sang `video.xx.fbcdn.net` với MỌI video Facebook - một bước định tuyến
       * CDN thường lệ. Bắt tự tải ở đó là đẩy 42 MB x 2 qua VPS mỗi lượt, trong
       * khi đường 1 vốn không tốn byte nào của ta.
       *
       * Rời tên miền thì khác: bên kia đang dắt ta sang một nơi khác hẳn, mà
       * `sendVideo` sẽ tự đi lại chặng đó bằng HEAD không qua lớp gác nào.
       */
      doiTenMien: boolean;
    }
  | { ok: false; ly: string };

/**
 * Kiểu nội dung có được coi là video không.
 *
 * Chặt: CHỈ `video/*` và `application/octet-stream`. Ca cần bắt là CDN trả
 * **200 kèm `text/html`** - trang "link đã hết hạn" hoặc trang chặn bot. Ca đó
 * không ném, `bytes > 0` nên cũng qua được cửa "nội dung rỗng", rồi nội dung
 * HTML được ghi ra `<tên>.mp4` và gửi đi như video. Người nhận nhận một tệp 2KB
 * không mở được, còn bot thì báo thành công.
 *
 * `application/octet-stream` được nhận vì một số CDN trả kiểu đó cho mp4; đó là
 * "không biết" chứ không phải "biết là HTML", nên chặn nó là chặn oan.
 */
export function laKieuVideo(kieu: string): boolean {
  const g = kieu.toLowerCase().split(";")[0]!.trim();
  return g.startsWith("video/") || g === "application/octet-stream";
}

/**
 * Quyết định cuối cùng từ header. Hàm THUẦN, tách ra để test được.
 *
 * Không tách thì phần QUYẾT ĐỊNH của bộ dò không có gì canh: đo được là bỏ cửa
 * `laKieuVideo` hoặc cửa status thì cả 2389 ca test vẫn xanh - vì mọi ca chạm
 * mạng đều bị `openGuardedRequest` chặn từ trước khi mở kết nối, không ca nào
 * đi tới đây. Tức `laKieuVideo` được chứng minh là đúng, nhưng "bộ dò CÓ gọi
 * nó" thì không ai chứng minh - mà chính cái sau mới là lỗi cần chặn.
 *
 * Cùng cách `ghiStreamRaFileCoTran` tách khỏi phần chạm mạng, và vì cùng lý do.
 */
export function quyetDinhTuHeader(
  status: number,
  kieu: string,
  dayDu: string | undefined,
  daiPhan: number,
  urlCuoi = "",
  doiTenMien = false,
): KetQuaDo {
  if (status < 200 || status >= 300) return { ok: false, ly: `HTTP ${status}` };
  if (!laKieuVideo(kieu)) {
    return { ok: false, ly: `Kiểu nội dung không phải video: ${kieu || "(trống)"}` };
  }
  return {
    ok: true,
    soByte: doCoThat(status, dayDu, daiPhan),
    kieuNoiDung: kieu,
    urlCuoi,
    doiTenMien,
  };
}

/**
 * Dò một lượt. KHÔNG ném - mọi đường hỏng đều trả `{ok:false}` kèm lý do ngắn
 * để ghi log, vì caller cần biết "không gửi được bằng URL" chứ không cần một
 * ngoại lệ phải bắt.
 */
export async function kiemUrlVideoConSong(rawUrl: string): Promise<KetQuaDo> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, ly: "URL không hợp lệ" };
  }

  const hostDau = url.hostname;

  for (let hop = 0; hop <= TRAN_HOP; hop++) {
    let res;
    try {
      // `identity` cùng lý do với đường tải: nếu CDN nén thì `content-length`
      // và `content-range` nói về cỡ ĐÃ NÉN, và trần dung lượng đọc sai số.
      res = await openGuardedRequest(url, TRAN_DO_MS, "GET", {
        range: "bytes=0-0",
        "Accept-Encoding": "identity",
      });
    } catch (err) {
      return { ok: false, ly: err instanceof Error ? err.message : String(err) };
    }

    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    const kieu = res.headers["content-type"] ?? "";
    const dayDu = res.headers["content-range"];
    const daiPhan = Number(res.headers["content-length"]);
    // Hủy NGAY sau khi có header: máy chủ nào bỏ qua `Range` sẽ trả 200 kèm
    // TRỌN file, và ta không có việc gì kéo về hàng chục MB chỉ để dò.
    res.destroy();

    if (status >= 300 && status < 400 && location) {
      try {
        url = new URL(location, url); // hop mới đi qua guard ở vòng lặp sau
      } catch {
        return { ok: false, ly: "Chuyển hướng tới URL không hợp lệ" };
      }
      continue;
    }

    return quyetDinhTuHeader(status, kieu, dayDu, daiPhan, url.href, !cungHo(hostDau, url.hostname));
  }

  return { ok: false, ly: `Quá ${TRAN_HOP} lần chuyển hướng` };
}
