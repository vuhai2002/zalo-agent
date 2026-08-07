# Dựng máy chủ lần đầu

Làm **một lần cho mỗi máy chủ**, không phải mỗi lần deploy. Deploy hằng ngày
xem [deployment-guide.md](deployment-guide.md).

Mọi giá trị riêng viết dạng `<chỗ-trống>` - thay bằng giá trị của bạn.

## 1. Những thứ cần có

```bash
docker --version          # cần Compose v2.16+ cho cờ --wait
docker compose version
git --version
```

Không cần cài Node trên máy chủ - mọi thứ build trong Docker.

## 2. Người dùng và thư mục

Đừng deploy bằng root. Tạo một user thường và cho vào nhóm `docker`:

```bash
sudo adduser --disabled-password <user-deploy>
sudo usermod -aG docker <user-deploy>
```

```bash
sudo mkdir -p <thư-mục-app> <thư-mục-dữ-liệu>
sudo chown <user-deploy>:<user-deploy> <thư-mục-app>

# Thư mục dữ liệu thuộc uid/gid TRONG container, không phải user deploy
sudo chown 1001:1001 <thư-mục-dữ-liệu>
# 700: chỉ chủ sở hữu đọc được. Lịch sử hội thoại nằm ở đây dưới dạng SQLite
# KHÔNG mã hóa - user khác trên cùng máy chủ không có việc gì phải đọc được.
sudo chmod 700 <thư-mục-dữ-liệu>
```

Tách thư mục dữ liệu ra ngoài thư mục code là có chủ đích: `git pull` và
`docker compose down` không bao giờ đụng tới nó.

## 3. Tường lửa

Chỉ mở SSH và HTTP/HTTPS. **Không mở cổng riêng cho app** - nó đi chung reverse
proxy.

```bash
sudo ufw allow <cổng-ssh>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

> [!WARNING]
> UFW **không** chặn được cổng do Docker publish. Docker ghi thẳng luật iptables
> ở nhánh trước UFW. Đó là lý do compose bind `127.0.0.1:<cổng>:3900` chứ không
> phải `0.0.0.0` - nếu bind `0.0.0.0` thì dashboard lộ ra internet dù `ufw status`
> trông vẫn kín.

Kiểm lại sau khi chạy - phải thấy `127.0.0.1:<cổng>`, không phải `0.0.0.0:<cổng>`:

```bash
ss -tlnp | grep <cổng>
```

## 4. Reverse proxy

Xem [`Caddyfile.site`](../Caddyfile.site) ở gốc repo: thay chỗ trống, nối vào
cấu hình Caddy rồi `caddy validate` + `systemctl reload caddy`.

Dùng Nginx hay Traefik cũng được - chỉ cần forward về `127.0.0.1:<cổng-host>` và
đặt `DASHBOARD_BEHIND_PROXY=true`.

## 5. Cron dọn Docker hằng tuần

`deploy.sh` chỉ dọn image mồ côi (giữ build cache cho lần deploy sau nhanh). Dọn
sâu để cron làm, vào lúc vắng:

```bash
sudo tee /etc/cron.d/docker-cleanup >/dev/null <<'EOF'
0 3 * * 0 <user-deploy> docker system prune -af --filter "until=168h" >/dev/null 2>&1
30 3 * * 0 <user-deploy> docker builder prune -af --keep-storage 2GB >/dev/null 2>&1
EOF
sudo chmod 0644 /etc/cron.d/docker-cleanup
```

Hai điều dễ sai:

- **Tên file cron KHÔNG được có dấu chấm** - `run-parts` bỏ qua file có dấu chấm.
- **Tuyệt đối không thêm `--volumes`** vào lệnh prune. Dữ liệu bot nằm ở volume;
  một cờ đó là mất sạch lịch sử và phiên Zalo.

## 6. Backup

Cần đúng hai thứ, và phải đi **cùng nhau**:

1. `<thư-mục-dữ-liệu>` (SQLite + cookie đã mã hóa + ảnh).
2. `CREDENTIALS_ENCRYPTION_KEY` trong `.env.production`.

Thiếu khóa thì bản backup vô dụng - nó là thứ giải mã cookie Zalo và mọi API key
trong DB.

```bash
cd <thư-mục-app>
docker compose -f docker-compose.prod.yml stop
sudo tar czf ~/zalo-agent-$(date +%F).tar.gz -C <thư-mục-dữ-liệu> .
docker compose -f docker-compose.prod.yml start
```

Dừng container trước khi nén: SQLite đang ghi mà chép file thì bản backup có thể
gãy giữa chừng.

## 7. Kiểm lại sau khi deploy lần đầu

```bash
# Container healthy
docker compose -f docker-compose.prod.yml ps

# Cổng CHỈ nghe trên loopback
ss -tlnp | grep <cổng-host>

# Chạy dưới user không phải root (phải ra uid=1001)
docker compose -f docker-compose.prod.yml exec zalo-agent id

# Dữ liệu nằm ngoài container: xóa container rồi dựng lại vẫn còn
docker compose -f docker-compose.prod.yml down
bash deploy.sh
```
