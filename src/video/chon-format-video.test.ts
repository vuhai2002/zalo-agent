import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Bộ chọn format nằm TRONG yt-dlp, không nằm trong code ta. Một hàm thuần chép
 * lại thuật toán chọn sẽ KHÔNG BAO GIỜ đỏ khi yt-dlp đổi hành vi - đúng cách bug
 * `^=avc` lọt qua: nó "trông đúng" nhưng khớp rỗng vì yt-dlp đổi nhãn h264.
 *
 * Nên test này chạy yt-dlp THẬT, nhưng OFFLINE và TẤT ĐỊNH: `--load-info-json`
 * nạp một danh sách format dựng sẵn rồi áp `-f`/`-S` lên đó. KHÔNG chạm mạng,
 * KHÔNG dính trang chống bot của TikTok (thứ khiến gọi mạng thật chập chờn).
 *
 * Máy test chưa cài yt-dlp thì mọi ca tự bỏ qua (giống môi trường CI tối giản).
 * Fixture dựng tối giản bằng tay nhưng cấu trúc trường lấy từ capture thật, đã
 * đối chiếu: yt-dlp chấp nhận và chọn y như trên JSON đầy đủ của video thật.
 */

let dataDir: string;
let chay: typeof import("./chay-yt-dlp.js");
let chon: typeof import("./chon-format-video.js");
let ytdlpCo = false;
let dem = 0;

before(async () => {
  dataDir = setupTestEnv();
  chay = await import("./chay-yt-dlp.js");
  chon = await import("./chon-format-video.js");
  // yt-dlp có trên máy này không? `--version` không chạm mạng.
  ytdlpCo = (await chay.chayYtDlp(["--version"], 15_000)).ok;
});

after(() => cleanupTestEnv(dataDir));

// `vcodec: "progressive"` = mp4 ghép sẵn nhưng yt-dlp KHÔNG parse được codec (đúng
// hình dạng format progressive của Instagram, `video_versions`). `acodec: "none"`
// = luồng chỉ-hình (DASH video-only). Hai cái này để test ca Instagram.
type SpecFormat = {
  format_id: string;
  vcodec: string;
  acodec?: string;
  width?: number;
  height?: number;
  note?: string;
};

/** Dựng một format tối giản đủ để yt-dlp sắp xếp; URL là dummy (offline, không tải) */
function dungFormat(f: SpecFormat): Record<string, unknown> {
  const dims = {
    ...(f.width ? { width: f.width } : {}),
    ...(f.height ? { height: f.height } : {}),
  };
  // Progressive: mp4 không mang trường vcodec/acodec - yt-dlp vẫn coi là ghép sẵn.
  if (f.vcodec === "progressive") {
    return { format_id: f.format_id, ext: "mp4", ...dims, url: `https://example.invalid/${f.format_id}.mp4`, protocol: "https" };
  }
  const chiTiengNoi = f.vcodec === "none";
  return {
    format_id: f.format_id,
    vcodec: f.vcodec,
    acodec: f.acodec ?? (chiTiengNoi ? "mp3" : "aac"),
    ext: chiTiengNoi ? "mp3" : "mp4",
    ...dims,
    ...(f.note ? { format_note: f.note } : {}),
    url: `https://example.invalid/${f.format_id}.${chiTiengNoi ? "mp3" : "mp4"}`,
    protocol: "https",
  };
}

function dungInfoJson(formats: SpecFormat[]): string {
  return JSON.stringify({
    id: "7",
    title: "video test co dau tieng viet",
    ext: "mp4",
    extractor: "TikTok",
    extractor_key: "TikTok",
    webpage_url: "https://www.tiktok.com/@x/video/7",
    _type: "video",
    formats: formats.map(dungFormat),
  });
}

/**
 * Cho yt-dlp áp bộ chọn `argsSel` lên danh sách format `formats` (offline), trả
 * về format nó CHỌN. `null` nếu không chọn được.
 */
async function chonTren(
  formats: SpecFormat[],
  argsSel: string[],
): Promise<{ id: string; vcodec: string } | null> {
  const duong = join(dataDir, `fx-${dem++}.json`);
  writeFileSync(duong, dungInfoJson(formats), "utf8");
  const r = await chay.chayYtDlp(
    ["--load-info-json", duong, "--skip-download", "--no-warnings", ...argsSel, "--print", "%(format_id)s|%(vcodec)s"],
    30_000,
  );
  if (!r.ok) return null;
  const dong = r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.includes("|"))
    .pop();
  if (!dong) return null;
  const [id, vcodec] = dong.split("|");
  return id ? { id, vcodec: vcodec ?? "" } : null;
}

// Fixture chính: có h264 540p VÀ h265 1080p. h265 phân giải CAO HƠN là cố ý - bộ
// chọn không biết ưu tiên codec sẽ lấy nhầm h265 (mặc định yt-dlp ưu tiên phân
// giải). Chọn đúng h264 chỉ xảy ra khi `-S vcodec:h264` thật sự có tác dụng.
const TIKTOK: SpecFormat[] = [
  { format_id: "audio", vcodec: "none" },
  { format_id: "download", vcodec: "h264", note: "watermarked" },
  { format_id: "h264_540p", vcodec: "h264", width: 768, height: 576 },
  { format_id: "bytevc1_1080p", vcodec: "h265", width: 1440, height: 1080 },
];

describe("chon-format-video: yt-dlp chọn đúng codec (offline, tất định)", () => {
  it("ưu tiên h264 dù h265 phân giải cao hơn, và KHÔNG lấy bản watermark", async (t) => {
    if (!ytdlpCo) return t.skip("yt-dlp chưa cài trên máy test");
    const ch = await chonTren(TIKTOK, chon.argsChonFormat());
    assert.ok(ch, "yt-dlp phải chọn được một format");
    assert.equal(ch!.vcodec, "h264", "phải là h264 cho máy cũ, không phải h265");
    assert.notEqual(ch!.id, "bytevc1_1080p", "không được chọn h265 dù nó nét hơn");
    assert.notEqual(ch!.id, "download", "không được chọn bản đóng logo");
  });

  it("bộ chọn CŨ `^=avc` lấy nhầm h265 - đây là bug đang sửa, canh để không quay lại", async (t) => {
    if (!ytdlpCo) return t.skip("yt-dlp chưa cài trên máy test");
    // Ghi lại tường minh vì sao đổi sang `-S`: cùng danh sách format, bộ chọn cũ
    // khớp rỗng (yt-dlp khai `vcodec="h264"` không phải `"avc1"`) rồi rơi về h265.
    // Ca này đỏ nghĩa là ai đó đưa `^=avc` trở lại, HOẶC yt-dlp đổi lại nhãn -
    // cả hai đều cần đọc lại quyết định.
    const ch = await chonTren(TIKTOK, ["-f", "b[vcodec^=avc][ext=mp4]/b[ext=mp4]/b"]);
    assert.equal(ch?.vcodec, "h265", "bộ chọn cũ khớp rỗng rồi lấy h265 - chính là bug");
  });

  it("nguồn khai codec kiểu `avc1.*` (Facebook / nguồn cũ) vẫn chọn được, lấy nét cao nhất", async (t) => {
    if (!ytdlpCo) return t.skip("yt-dlp chưa cài trên máy test");
    const ch = await chonTren(
      [
        { format_id: "audio", vcodec: "none" },
        { format_id: "sd", vcodec: "avc1.4d401f", width: 640, height: 360 },
        { format_id: "hd", vcodec: "avc1.640028", width: 1280, height: 720 },
      ],
      chon.argsChonFormat(),
    );
    assert.match(ch?.vcodec ?? "", /^avc1/, "`-S vcodec:h264` phải nhận avc1 là h264");
    assert.equal(ch?.id, "hd", "cùng codec thì lấy phân giải cao nhất");
  });

  it("chỉ có h265 thì vẫn lấy h265 (lùi mềm, không rỗng, không lỗi)", async (t) => {
    if (!ytdlpCo) return t.skip("yt-dlp chưa cài trên máy test");
    const ch = await chonTren(
      [
        { format_id: "audio", vcodec: "none" },
        { format_id: "h265_540p", vcodec: "h265", width: 768, height: 576 },
        { format_id: "h265_1080p", vcodec: "h265", width: 1440, height: 1080 },
      ],
      chon.argsChonFormat(),
    );
    assert.equal(ch?.vcodec, "h265", "không có h264 thì h265 còn hơn không gửi được");
    assert.equal(ch?.id, "h265_1080p");
  });

  it("bản h264 duy nhất là watermark + có h265 sạch -> chọn h265 sạch", async (t) => {
    if (!ytdlpCo) return t.skip("yt-dlp chưa cài trên máy test");
    const ch = await chonTren(
      [
        { format_id: "audio", vcodec: "none" },
        { format_id: "download", vcodec: "h264", note: "watermarked" },
        { format_id: "bytevc1_1080p", vcodec: "h265", width: 1440, height: 1080 },
      ],
      chon.argsChonFormat(),
    );
    assert.equal(ch?.id, "bytevc1_1080p", "thà h265 sạch còn hơn h264 đóng logo");
  });

  it("Instagram DASH: chọn PROGRESSIVE muxed, KHÔNG chọn dash video-only (tránh video câm / cần ghép)", async (t) => {
    if (!ytdlpCo) return t.skip("yt-dlp chưa cài trên máy test");
    // IG trả DASH (hình + tiếng tách) CỘNG mp4 progressive ghép sẵn. Design cố ý
    // không cài ffmpeg nên KHÔNG được chọn luồng chỉ-hình (sẽ câm hoặc phải ghép).
    // `b`/best chỉ lấy luồng có sẵn cả hình+tiếng -> phải rơi vào progressive, dù
    // dash video-only có phân giải cao hơn (720x1280). Đo thật: yt-dlp chọn đúng.
    const ch = await chonTren(
      [
        { format_id: "dash-audio", vcodec: "none" },
        { format_id: "prog", vcodec: "progressive" },
        { format_id: "dash-video", vcodec: "avc1.64001F", acodec: "none", width: 720, height: 1280 },
      ],
      chon.argsChonFormat(),
    );
    assert.equal(ch?.id, "prog", "phải chọn progressive muxed, KHÔNG chọn dash video-only 720x1280");
  });
});

/**
 * Sàn kiểm KHÔNG cần yt-dlp. Các ca hành vi ở trên tự `skip` khi máy chưa cài
 * yt-dlp (vd CI tối giản) - lúc đó chúng không còn canh selector nữa, nên đổi
 * hằng số sai có thể lọt qua full suite mà vẫn xanh. Mấy khẳng định dưới đây pin
 * ba bất biến thiết kế bằng chuỗi thuần, chạy ở MỌI máy - lưới đỡ cuối cho ca đó.
 * KHÔNG thay các ca hành vi thật (chỉ chuỗi mới bắt được "yt-dlp chọn ra gì").
 */
describe("chon-format-video: bất biến hằng số (không cần yt-dlp)", () => {
  it("CHON_SORT ưu tiên h264 cho máy cũ", () => {
    assert.ok(chon.CHON_SORT.includes("vcodec:h264"), `phải ưu tiên h264: ${chon.CHON_SORT}`);
  });

  it("CHON_FORMAT loại bản watermark, không có nhánh ghép (cần ffmpeg), ưu tiên mp4", () => {
    assert.ok(chon.CHON_FORMAT.includes("format_id!=download"), "phải loại bản watermark `download`");
    assert.ok(!chon.CHON_FORMAT.includes("+"), "không được có nhánh ghép hình+tiếng - image không cài ffmpeg");
    assert.ok(chon.CHON_FORMAT.includes("mp4"), "phải ưu tiên mp4 để Zalo phát được");
  });
});
