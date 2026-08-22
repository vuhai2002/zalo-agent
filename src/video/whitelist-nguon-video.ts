/**
 * Chỉ cho phép tải video từ những host đã liệt kê.
 *
 * VÌ SAO PHẢI CÓ: bot đọc tin của NGƯỜI LẠ, và tool này nhận một URL rồi đi
 * tải. Không chặn ở đây thì người ngoài soạn một tin nhắn là bắt được VPS gửi
 * request tới bất cứ đâu - kể cả `http://127.0.0.1:*` (các app khác đang chạy
 * trên cùng máy) hay endpoint metadata của nhà cung cấp đám mây. Đó là SSRF,
 * và nó nguy hiểm hơn hẳn nỗi lo "video cài mã độc": file video nằm trên đĩa
 * mà không ai giải mã thì vô hại, còn SSRF thì chạm được vào thứ khác.
 *
 * DANH SÁCH TRẮNG chứ không phải danh sách đen: danh sách đen luôn thiếu, và
 * cái thiếu là cái lọt.
 */

/** Nền tảng nhận ra được - quyết định đi nguồn nào ở tầng trên */
export type NenTangVideo = "tiktok" | "facebook";

/**
 * Host được phép, kèm nền tảng tương ứng.
 *
 * So khớp theo ĐUÔI host (`a.b.com` khớp `b.com`) chứ không phải `includes`:
 * `includes` cho `tiktok.com.ke-tan-cong.net` lọt qua. Cũng không dùng regex
 * trên cả URL - `https://ke-tan-cong.net/?x=tiktok.com` lọt.
 */
const HOST_CHO_PHEP: { hau: string; nenTang: NenTangVideo }[] = [
  { hau: "tiktok.com", nenTang: "tiktok" },
  { hau: "douyin.com", nenTang: "tiktok" },
  { hau: "facebook.com", nenTang: "facebook" },
  { hau: "fb.watch", nenTang: "facebook" },
  { hau: "fb.com", nenTang: "facebook" },
];

/**
 * Host chỉ tồn tại để CHUYỂN HƯỚNG, cấm bất kể query mang gì.
 *
 * Luật này TƯỞNG là thừa sau khi có `mangUrlKhacTrongQuery`, và tôi đã suýt bỏ
 * nó. Phép kiểm SIÊU TẬP bắt được: `https://L.FaceBook.CoM/l.php?u=x` bản cũ
 * chặn còn bản "mạnh hơn" thì CHO LỌT - vì `x` không phải một URL nên luật hình
 * dạng không thấy gì. Hai luật bắt hai thứ khác nhau, giữ cả hai.
 *
 * (Đây đúng bài học đã ghi trong CLAUDE.md: thay một luật bảo mật bằng bản
 * "mạnh hơn" thì phải chứng minh tập bắt mới BAO tập cũ, chứ không chỉ đo chiều
 * mới. Lần này chính phép đo đó bắt được hồi quy.)
 *
 * `l.instagram.com` / `l.messenger.com` hôm nay là thừa - hai tên miền đó vốn
 * không nằm trong danh sách cho phép. Giữ lại làm bản ghi ý định phòng khi sau
 * này có ai thêm Instagram vào; chúng KHÔNG được tính vào độ phủ test.
 */
const HOST_CHI_DE_CHUYEN_HUONG = [
  "l.facebook.com",
  "lm.facebook.com",
  "l.instagram.com",
  "l.messenger.com",
];

/**
 * URL này có MANG MỘT URL KHÁC bên trong tham số truy vấn không?
 *
 * Đây là lớp chặn SSRF, và nó thay cho một bản vá SAI CÁCH ở vòng trước.
 *
 * Bản trước cấm theo TÊN MIỀN: `l.facebook.com`, `lm.facebook.com`. Nhưng năng
 * lực chuyển hướng KHÔNG nằm ở hai tên đó - `/l.php?u=` và `/flx/warn/?u=` chạy
 * y hệt trên `www.facebook.com`, `m.facebook.com`, `mbasic.facebook.com`,
 * `free.facebook.com`, tức những tên BẮT BUỘC phải cho qua vì video thật nằm ở
 * đó. Cấm theo tên miền là khoá một cửa của toà nhà mười cửa.
 *
 * ĐÃ ĐO bằng máy chủ nghe thật ở `127.0.0.1:8791`: cả 5 biến thể trên đều lọt
 * whitelist VÀ khiến yt-dlp gửi request thật vào địa chỉ nội bộ. Cho listener
 * trả `content-type: video/mp4` thì yt-dlp còn trả về `videoUrl` trỏ vào chính
 * `127.0.0.1` - địa chỉ đó rồi chảy tiếp xuống đường gửi.
 *
 * Luật ở đây nói về HÌNH DẠNG chứ không về tên: từ chối mọi URL mang một địa
 * chỉ khác trong query. Nhờ vậy nó phủ luôn những endpoint chuyển hướng chưa ai
 * biết, thay vì phải đuổi theo từng cái tên.
 *
 * ĐO ĐỘ CHÍNH XÁC: chặn 8/8 payload tấn công (kể cả `//host` không scheme và
 * dạng mã hóa hai lớp `%2568ttp`), chặn oan 0/10 dạng link thật - đã thử cả
 * link kèm `fbclid`, `mibextid`, `is_from_webapp`, `sender_device`. Link video
 * thật không bao giờ nhét một URL khác vào query.
 */
function mangUrlKhacTrongQuery(u: URL): boolean {
  for (const [, giaTri] of u.searchParams) {
    // `searchParams` đã giải mã một lớp. Giải thêm một lớp nữa để bắt dạng mã
    // hóa hai lần (`%2568ttp` -> `%68ttp` -> `http`), vốn là cách né hiển nhiên
    // nhất khi biết có bộ lọc.
    let v = giaTri.trim();
    try {
      v = decodeURIComponent(v).trim();
    } catch {
      // Chuỗi mã hóa hỏng thì giữ nguyên bản đã giải một lớp - vẫn kiểm được.
    }
    // Có scheme rõ (`http://`, `https://`) HOẶC dạng lược scheme (`//host`).
    if (/^(https?:)?\/\//i.test(v)) return true;
    // Dạng còn nguyên phần trăm sau khi giải: `https%3a//...`
    if (/^https?%3a/i.test(v)) return true;
  }
  return false;
}

export type KetQuaWhitelist =
  | {
      ok: true;
      nenTang: NenTangVideo;
      /**
       * URL ĐÃ CHUẨN HÓA (`URL.href`), KHÔNG phải chuỗi người dùng gửi.
       *
       * Đây là chỗ từng có lỗ hổng THẬT, đã chứng minh chạy được, nên đọc kỹ
       * trước khi đổi: hàm này kiểm host bằng `new URL()` của Node (WHATWG),
       * còn yt-dlp phân tích lại bằng `urllib` của Python. Hai bộ không đồng ý
       * về dấu `\`:
       *
       *   payload: http://tiktok.com\@127.0.0.1:8791/api/tuning
       *   Node   -> hostname "tiktok.com"      (whitelist CHO QUA)
       *   Python -> hostname "127.0.0.1" :8791 (yt-dlp GỌI VÀO ĐÂY)
       *
       * Đã dựng máy chủ ở 127.0.0.1:8791 và chạy yt-dlp thật: máy chủ nội bộ
       * NHẬN ĐƯỢC request. Tức whitelist gác một địa chỉ còn yt-dlp đi một địa
       * chỉ khác - đúng thứ lớp này sinh ra để chặn.
       *
       * `href` chuẩn hóa `\` thành `/` nên Python đọc lại ra `tiktok.com`. Trả
       * chuỗi thô là mở lại lỗ hổng.
       */
      url: string;
    }
  | { ok: false; loi: string };

/**
 * URL này có được phép tải không, và nếu có thì thuộc nền tảng nào.
 *
 * Trả object thay vì ném: caller là tool, mà luật của repo là tool KHÔNG ném ra
 * agent loop.
 */
export function kiemNguonVideo(urlTho: string): KetQuaWhitelist {
  const chuoi = urlTho.trim();
  if (chuoi === "") return { ok: false, loi: "Chưa có đường dẫn video." };

  let u: URL;
  try {
    u = new URL(chuoi);
  } catch {
    return { ok: false, loi: "Đường dẫn không hợp lệ - phải là một URL đầy đủ." };
  }

  // CHỈ http/https. Chặn `file://` (đọc file trên máy), `ftp://`, và các scheme
  // lạ mà thư viện tải có thể hiểu theo cách bất ngờ.
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, loi: "Chỉ nhận đường dẫn http hoặc https." };
  }

  // Từ chối phần userinfo (`user:pass@host`). Đây là lớp CHUNG của cả họ lỗi
  // "host thật nằm sau dấu @": các bộ phân tích khác nhau cắt userinfo ở chỗ
  // khác nhau, nên URL hợp lệ với bên này lại trỏ đi nơi khác với bên kia.
  // Link TikTok/Facebook thật không bao giờ có userinfo, nên chặn thẳng không
  // mất gì.
  if (u.username !== "" || u.password !== "") {
    return { ok: false, loi: "Đường dẫn chứa thông tin đăng nhập - không nhận." };
  }

  const host = u.hostname.toLowerCase().replace(/\.$/, "");

  // Luật chống chuyển hướng chạy TRƯỚC danh sách cho phép - xem khối chú thích
  // ở `mangUrlKhacTrongQuery`.
  if (HOST_CHI_DE_CHUYEN_HUONG.includes(host) || mangUrlKhacTrongQuery(u)) {
    return {
      ok: false,
      loi:
        "Đường dẫn này mang một địa chỉ khác bên trong (dạng link chuyển tiếp), không phải link " +
        "video. Xin người dùng gửi link video gốc.",
    };
  }

  const khop = HOST_CHO_PHEP.find((h) => host === h.hau || host.endsWith(`.${h.hau}`));
  if (!khop) {
    return {
      ok: false,
      loi: "Chỉ tải được video từ TikTok và Facebook. Đường dẫn này không thuộc hai nơi đó.",
    };
  }

  // `u.href` chứ KHÔNG phải `chuoi` - xem khối chú thích ở `KetQuaWhitelist`.
  return { ok: true, nenTang: khop.nenTang, url: u.href };
}

/**
 * Bóc URL video đầu tiên tìm thấy trong một đoạn chữ.
 *
 * Người dùng hiếm khi dán mỗi cái link - họ viết "tải hộ cái này với
 * https://vt.tiktok.com/ABC/ nhé". Model có thể tự bóc, nhưng để nó tự bóc thì
 * mỗi lần một kiểu; bóc ở đây thì luật whitelist luôn chạy trên đúng chuỗi đã
 * chuẩn hóa.
 */
export function timUrlTrongChu(chu: string): string | null {
  const khop = chu.match(/https?:\/\/[^\s<>"']+/i);
  if (!khop) return null;
  // Bỏ dấu câu dính đuôi khi người ta viết "... link https://a.b/c."
  return khop[0].replace(/[.,;:!?)\]}]+$/, "");
}
