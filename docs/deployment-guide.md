# Triển khai lên máy chủ

Hướng dẫn chung. Mọi giá trị riêng của máy chủ bạn (IP, cổng, tên miền, đường
dẫn) viết dưới dạng `<chỗ-trống>` - thay bằng giá trị của bạn.

Kiến trúc đích:

```text
Internet 443
  -> reverse proxy trên host (Caddy / Nginx / Traefik)
  -> 127.0.0.1:<cổng-host>
  -> container zalo-agent (lắng nghe 3900 bên trong)
  -> volume /data  (SQLite, cookie Zalo đã mã hóa, ảnh tải về)
```

Bot **không dùng cơ sở dữ liệu ngoài**. Toàn bộ trạng thái nằm trong một thư
mục, nên phần khó nhất của việc triển khai chỉ là: giữ thư mục đó sống qua mọi
lần deploy, và backup nó.

## Trước khi bắt đầu

Trên máy chủ cần: Docker (kèm Compose v2.16+ cho cờ `--wait`), git, và một
reverse proxy đã chạy. Không cần cài Node - mọi thứ build trong Docker.

Máy chủ mới tinh thì làm [vps-setup-checklist.md](vps-setup-checklist.md) một
lần trước (user deploy, thư mục, tường lửa, cron dọn Docker, backup).

> [!WARNING]
> `zca-js` là API **không chính thức**, Zalo có thể khóa tài khoản.
> **Chỉ dùng nick phụ.** Ngoài ra Zalo chỉ cho **một listener mỗi tài khoản**:
> mở Zalo Web trong trình duyệt sẽ đá listener của bot. Đừng chạy hai bản.

## 1. Lấy code và cấu hình

```bash
git clone <url-repo> <thư-mục-app>
cd <thư-mục-app>
cp .env.production.example .env.production
chmod 600 .env.production
```

Điền hai biến bắt buộc trong `.env.production`:

| Biến | Cách lấy |
|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DASHBOARD_PASSWORD` | tự chọn, tối thiểu 8 ký tự |

Mọi thứ còn lại (nhà cung cấp LLM, model, API key) nhập trên dashboard sau khi
chạy - chúng lưu vào DB và API key được mã hóa.

> `CREDENTIALS_ENCRYPTION_KEY` giải mã cookie Zalo và mọi API key trong DB.
> **Backup nó cùng chỗ với backup dữ liệu** - mất khóa thì bản backup vô dụng.
> Đổi khóa = mất phiên Zalo đã lưu và toàn bộ API key đã nhập.

### Cấu hình riêng của máy chủ

Compose đọc file `.env` (khác `.env.production`) để thay biến. Tạo nó nếu bạn
cần đổi cổng host hoặc nơi chứa dữ liệu:

```bash
# .env  - chỉ Compose đọc, không phải biến của ứng dụng
ZALO_AGENT_HOST_PORT=<cổng-host>          # mặc định 3900
ZALO_AGENT_DATA_DIR=<đường-dẫn-dữ-liệu>   # mặc định named volume
```

Đặt ở đây thay vì sửa thẳng `docker-compose.prod.yml`: sửa file trong repo là
lần `git pull` sau xung đột.

Nếu để mặc định thì dữ liệu nằm trong named volume `zalo-agent-data` do Docker
quản lý. Muốn thấy được bằng `ls` và backup dễ hơn thì trỏ ra đường dẫn thật:

```bash
sudo mkdir -p <đường-dẫn-dữ-liệu>
sudo chown 1001:1001 <đường-dẫn-dữ-liệu>   # uid/gid trong container
```

## 2. Chạy

```bash
bash deploy.sh
```

Script sẽ: kiểm `.env.production` -> `git pull --ff-only` -> build -> `up -d`
và **đợi container báo healthy** (tối đa 120s) -> dọn image mồ côi. Không
healthy thì nó in 80 dòng log cuối rồi thoát khác 0.

## 3. Reverse proxy

Khối Caddy đầy đủ (kèm phần đứng sau Cloudflare) nằm ở
[`Caddyfile.site`](../Caddyfile.site) tại gốc repo - thay chỗ trống rồi nối vào
`/etc/caddy/Caddyfile`. Rút gọn:

```caddyfile
<tên-miền> {
	reverse_proxy 127.0.0.1:<cổng-host>
	encode gzip zstd
	header {
		X-Content-Type-Options nosniff
		X-Frame-Options SAMEORIGIN
		Referrer-Policy strict-origin-when-cross-origin
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}
}
```

Nhớ đặt `DASHBOARD_BEHIND_PROXY=true` trong `.env.production` - nếu không,
cookie phiên thiếu cờ `Secure` và rate-limit đăng nhập đọc nhầm IP.

## 4. Đăng nhập Zalo

Mở dashboard bằng tên miền vừa cấu hình, đăng nhập bằng `DASHBOARD_PASSWORD`,
rồi:

1. **Cấu hình > Nhà cung cấp LLM**: nhập base URL, model, API key. Bấm Test kết nối.
2. **Tài khoản > Thêm tài khoản**: quét mã QR **ngay trong trình duyệt**.

Không cần vào terminal của container: luồng QR chạy hoàn toàn qua web.

## Vận hành

### Cập nhật

```bash
cd <thư-mục-app> && bash deploy.sh
```

### Xem log

```bash
docker compose -f docker-compose.prod.yml logs -f --tail 100
```

Log cũng ghi ra file trong `<dữ-liệu>/logs/` (xoay theo ngày, giữ
`LOG_FILE_KEEP_DAYS` ngày) và xem được ở trang Logs trên dashboard.

### Backup

Chỉ cần hai thứ, và phải đi **cùng nhau**:

1. Thư mục dữ liệu (SQLite + cookie đã mã hóa + ảnh).
2. `CREDENTIALS_ENCRYPTION_KEY`.

```bash
docker compose -f docker-compose.prod.yml stop
tar czf zalo-agent-$(date +%F).tar.gz -C <đường-dẫn-dữ-liệu> .
docker compose -f docker-compose.prod.yml start
```

Dừng container trước khi nén: SQLite đang ghi mà chép file là bản backup có thể
gãy giữa chừng.

### Rollback

Không có rollback tự động:

```bash
git log --oneline -5
git checkout <sha>
DEPLOY_SKIP_PULL=1 bash deploy.sh
```

Dữ liệu không bị đụng - nó nằm ngoài image.

## Gỡ rối

| Triệu chứng | Nguyên nhân hay gặp |
|---|---|
| Proxy báo 502 / connection refused | `DASHBOARD_HOST` bị ghi đè thành `127.0.0.1` trong `.env.production`. Trong container phải là `0.0.0.0` - Dockerfile đặt sẵn, đừng ghi đè |
| Container mãi không healthy | Xem `logs --tail 80`. Hay gặp nhất: thiếu `CREDENTIALS_ENCRYPTION_KEY` |
| Dashboard trắng trang, API vẫn chạy | Thiếu bản build giao diện. Build lại image (`docker compose build --no-cache`) |
| Đăng nhập dashboard xong bị đá ra | Chạy sau HTTPS mà quên `DASHBOARD_BEHIND_PROXY=true` |
| Container ghi được nhưng khởi động lại là mất dữ liệu | Volume chưa mount, hoặc thư mục host sai chủ sở hữu (phải là `1001:1001`) |
| Bot im, log báo bị đá listener | Có phiên Zalo Web khác đang mở cùng tài khoản |

## Không có sẵn trong repo

Có chủ đích, vì chúng phụ thuộc hạ tầng của bạn: CI/CD, registry image, và
orchestrator. Image build thẳng trên máy chủ sau `git pull`; deploy là chạy
`deploy.sh` qua SSH.
