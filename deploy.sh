#!/usr/bin/env bash
#
# Deploy zalo-agent lên máy chủ. Chạy TRÊN máy chủ, trong thư mục chứa file này.
#
#     bash deploy.sh
#
# Biến điều khiển:
#     DEPLOY_SKIP_PULL=1       bỏ qua git pull (đang thử một bản local)
#     DEPLOY_SKIP_PRUNE=1      bỏ qua bước dọn image
#     DEPLOY_HEALTH_TIMEOUT=n  số giây chờ container báo healthy (mặc định 120)
#
# Không có bước rollback tự động. Muốn lùi: `git log --oneline -5` ->
# `git checkout <sha>` -> chạy lại script này.

set -euo pipefail

# Tự định vị thư mục để gọi từ đâu cũng đúng (vd cron, hay `bash /opt/.../deploy.sh`)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
# Nhãn lấy từ tên thư mục - đổi tên thư mục là log đi theo, không phải sửa script
NHAN="$(basename "$SCRIPT_DIR")"
TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-120}"

echo "[$NHAN] bắt đầu deploy ($(date '+%F %T'))"

# --- Cửa kiểm: thiếu cấu hình thì DỪNG, đừng chạy nửa vời -------------------
# Thiếu file này container vẫn khởi động được rồi chết vì không có
# CREDENTIALS_ENCRYPTION_KEY - lỗi hiện ra ở tận log container, xa chỗ gây ra.
if [ ! -f .env.production ]; then
  echo "THIẾU .env.production - chép từ .env.production.example rồi điền" >&2
  echo "  cp .env.production.example .env.production && chmod 600 .env.production" >&2
  exit 1
fi

# Khóa mã hóa là biến DUY NHẤT thiếu là bot không khởi động được. Bắt ở đây để
# lỗi hiện ngay trên màn hình người deploy, không phải đi đào log.
if ! grep -qE '^CREDENTIALS_ENCRYPTION_KEY=.+' .env.production; then
  echo "CREDENTIALS_ENCRYPTION_KEY trong .env.production đang trống" >&2
  echo "  tạo: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" >&2
  exit 1
fi

# --- Lấy code mới ------------------------------------------------------------
# `--ff-only`: không bao giờ tạo merge commit, và fail an toàn nếu bản clone
# trên máy chủ đã phân kỳ hoặc đang ở detached HEAD (tức là đang rollback).
if [ "${DEPLOY_SKIP_PULL:-0}" != "1" ]; then
  echo "[$NHAN] git pull --ff-only"
  git pull --ff-only
fi

echo "[$NHAN] build image"
docker compose -f "$COMPOSE_FILE" build

# --- Chạy và ĐỢI healthy ------------------------------------------------------
# `--wait` thay cho `sleep` + curl: một nguồn sự thật duy nhất là khối
# `healthcheck:` trong compose, không phải hai chỗ đoán nhau.
echo "[$NHAN] up -d, đợi healthy (tối đa ${TIMEOUT}s)"
if ! docker compose -f "$COMPOSE_FILE" up -d --remove-orphans --wait --wait-timeout "$TIMEOUT"; then
  echo "[$NHAN] KHÔNG healthy trong ${TIMEOUT}s - log 80 dòng cuối:" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail 80 --no-color >&2
  exit 1
fi

# --- Dọn dẹp -----------------------------------------------------------------
# CHỈ image mồ côi. Không `docker system prune -af`: nó xóa sạch build cache
# trên một máy chủ dùng chung nhiều dự án, biến mọi lần deploy sau thành build
# lạnh. Dọn sâu để cho cron hằng tuần lo.
if [ "${DEPLOY_SKIP_PRUNE:-0}" != "1" ]; then
  echo "[$NHAN] dọn image mồ côi"
  docker image prune -f --filter "dangling=true" >/dev/null
fi

echo "[$NHAN] xong ($(date '+%F %T'))"
docker compose -f "$COMPOSE_FILE" ps
