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
