# syntax=docker/dockerfile:1
# Bốn stage: deps -> builder -> prod-deps -> runner.
#
# Vì sao tách `prod-deps` riêng thay vì ba stage như thường lệ: runner cần
# `node_modules` CHỈ có dependency production. Chép từ `deps` sang là mang theo
# cả TypeScript, Vite, React và toàn bộ cây dev - image phình lên vô ích, mà
# công cụ build nằm trong ảnh chạy production cũng là bề mặt tấn công thừa.
#
# Chạy BẢN BIÊN DỊCH (`node dist/src/index.js`), không chạy `tsx` như lúc dev:
# `tsx` là devDependency nên runner không có nó, và runtime production không
# việc gì phải mang theo trình biên dịch TypeScript.

# ---------------------------------------------------------------------------
# node:24 chứ không phải 22, và đây là lựa chọn CÓ LÝ DO chứ không phải mặc
# định: bot lưu dữ liệu bằng `node:sqlite` (built-in). Trên Node 22 module đó
# còn nằm sau cờ `--experimental-sqlite`; từ Node 24 thì import thẳng được, chỉ
# còn một dòng cảnh báo. Ghim 24 để khỏi phải truyền cờ vào mọi lệnh chạy.
#
# Alpine: bot không dùng thư viện native nào cần glibc (kiểm cả 14 dependency),
# nên musl chạy tốt và ảnh nhẹ hơn nhiều.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
ENV CI=true
RUN corepack enable
# Chép đủ 3 file cấu hình pnpm: `pnpm-workspace.yaml` là nơi pnpm v11 đọc
# `minimumReleaseAge` (phòng vệ chuỗi cung ứng). Bỏ sót nó là build vẫn chạy
# nhưng lớp phòng vệ im lặng biến mất.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile


FROM node:24-alpine AS builder
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Hai bản build cho hai thứ khác nhau: `build` ra `dist/` (bot), `build:web` ra
# `web/dist/` (giao diện dashboard). `web/dist` nằm trong .gitignore nên trên
# VPS `git pull` KHÔNG mang nó theo - phải dựng ở đây, thiếu bước này thì
# dashboard trả 404 cho mọi đường dẫn còn API vẫn chạy, rất khó đoán bệnh.
RUN pnpm build && pnpm build:web


FROM node:24-alpine AS prod-deps
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile


FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# PHẢI là 0.0.0.0 trong container: `127.0.0.1` ở đây là loopback của chính
# container, Docker không chuyển tiếp cổng vào đó được và reverse proxy chỉ
# nhận connection refused. Việc không phơi ra internet do phía host lo, bằng
# cách publish `127.0.0.1:<host>:<container>` trong compose.
ENV DASHBOARD_HOST=0.0.0.0

# yt-dlp cho tool `tai_video`: nguồn DUY NHẤT của Facebook và là tầng dự phòng
# của TikTok. Thiếu nó thì Facebook hỏng 100% còn TikTok mất hẳn tầng 2, mà lỗi
# thì đội lốt "video riêng tư" trong câu trả lời cho người dùng nếu tầng dưới
# không nhận ra. `chay-yt-dlp.ts` nhận ra CẢ HAI hình dạng (thiếu binary =
# ENOENT, thiếu module = mã thoát 1 kèm "No module named yt_dlp") rồi bật cờ
# `loiCauHinh` - ca thứ hai mới là ca image này gặp.
#
# `python3` chứ không phải `python`: Alpine chỉ có `python3` trong PATH, nên
# `PYTHON_PATH` phải đặt tường minh (mặc định trong code là `python`).
#
# Python >= 3.10 theo `requires_python` của yt-dlp 2026.10.21 (master đã nâng lên
# 3.11 cho bản kế). node:24-alpine hiện là alpine3.24 cấp Python 3.14.8 - ghi lại
# để lần nâng base image biết cần kiểm gì.
#
# GHIM phiên bản + hash, không `pip install yt-dlp` trần. Bản trần trông như
# "luôn mới nhất" nhưng thật ra ngược lại: dòng RUN không đổi chữ nào nên luôn
# trúng cache của Docker, và `deploy.sh` build có cache - máy chủ cứ thế giữ bản
# của lần build ĐẦU mà không ai hay. Ghim số thì đổi số là vỡ cache có chủ đích,
# mọi máy cùng một bản, và hash chặn được tarball bị tráo trên đường tải (cùng ý
# `minimumReleaseAge` của pnpm). Nâng: đọc Changelog yt-dlp mục TikTok/Facebook/
# Instagram, đổi HAI ARG dưới (hash lấy ở https://pypi.org/pypi/yt-dlp/<bản>/json,
# file `.whl`), chạy `npx tsx --test src/video/chon-format-video.test.ts`.
# Core yt-dlp không có dependency nào (`--no-deps` an toàn, `--only-binary`
# buộc lấy đúng file wheel đã băm).
#
# `--break-system-packages`: Alpine đánh dấu môi trường Python là "externally
# managed" (PEP 668). Đây là container dùng một việc, không có gì để vỡ.
#
# Gỡ pip sau khi cài để không để lại công cụ cài đặt trong image chạy production.
#
# Bước kiểm cuối chạy `python3 -m yt_dlp` chứ KHÔNG chạy `yt-dlp`: đó mới là
# đường mà runtime dùng (xem `lenhYtDlp`). Kiểm bằng console script thì một image
# có script nhưng hỏng module vẫn build xanh. Bước kiểm nằm SAU `apk del` trong
# CÙNG một RUN, nên nếu gỡ pip có làm hỏng gì thì build đỏ ngay tại đây.
ARG YTDLP_VERSION=2026.10.21
ARG YTDLP_WHEEL_SHA256=94a3a3e2c423129d0bbd2f1be000c4171fa1226c29e251c84aff868f2851c247
RUN apk add --no-cache python3 py3-pip \
    && printf 'yt-dlp==%s --hash=sha256:%s\n' "$YTDLP_VERSION" "$YTDLP_WHEEL_SHA256" > /tmp/yt-dlp-req.txt \
    && pip3 install --no-cache-dir --break-system-packages --require-hashes --no-deps --only-binary=:all: -r /tmp/yt-dlp-req.txt \
    && rm /tmp/yt-dlp-req.txt \
    && apk del py3-pip \
    && python3 -m yt_dlp --version
ENV PYTHON_PATH=python3
# Cache của yt-dlp. `adduser --system` KHÔNG tạo /home/zalo, nên thiếu dòng này
# thì nó ghi cache vào một thư mục không tồn tại và `--no-warnings` nuốt luôn
# cảnh báo - không chết, chỉ mất cache trong im lặng. Biến này nằm trong danh
# sách CHO PHÉP của `chay-yt-dlp.ts` nên chở được sang tiến trình con.
ENV XDG_CACHE_HOME=/tmp

# uid/gid 1001 rời hẳn user `node` (uid 1000) có sẵn trong image - cùng cách 4
# dịch vụ khác đang chạy trên VPS này làm, để quyền trên thư mục dữ liệu mount
# vào là con số biết trước chứ không phụ thuộc image.
RUN addgroup --system --gid 1001 zalo && adduser --system --uid 1001 --ingroup zalo zalo

COPY --from=prod-deps --chown=zalo:zalo /app/node_modules ./node_modules
COPY --from=builder --chown=zalo:zalo /app/dist ./dist
COPY --from=builder --chown=zalo:zalo /app/web/dist ./web/dist
COPY --chown=zalo:zalo package.json ./

# Thư mục dữ liệu tạo sẵn và cấp quyền TRƯỚC khi đổi user: volume mount đè lên
# đường dẫn này lúc chạy, nhưng lần đầu chưa có volume thì container vẫn phải
# ghi được, không thì chết ngay lúc mở SQLite.
RUN mkdir -p /data && chown zalo:zalo /data
ENV DATA_DIR=/data
VOLUME ["/data"]

USER zalo
EXPOSE 3900

# Entry là `dist/src/index.js` chứ không phải `dist/index.js`: tsconfig gom cả
# `scripts/` nên tsc giữ lại một tầng thư mục.
CMD ["node", "dist/src/index.js"]
