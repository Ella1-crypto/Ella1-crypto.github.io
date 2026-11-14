# 미디어 다운로더 — Oracle Cloud 무료 VM에 올리기 (24시간용)

PC를 꺼도 쓸 수 있게 Oracle 무료 VM에서 같은 서버를 돌립니다. 비용은 0원입니다.
Oracle 서버가 막히면(주로 YouTube "봇 확인") 페이지가 **자동으로 PC 서버로** 다시 시도합니다.

```
다운로더 페이지
  ① https://<IP>.sslip.io (Oracle, 24시간)        ← 평소
  ② https://xxxx.trycloudflare.com (내 PC)        ← ①이 막혔을 때. PC가 켜질 때 자기 주소를 ①에 등록해 둠
```

리전은 오사카여도 괜찮습니다(보유세맵과 달리 국내 IP가 필요 없음).

## 1. VM 만들기 · 방화벽 열기

보유세맵 안내와 똑같습니다: [`../holding-tax-api/RELAY-ORACLE.md`](../holding-tax-api/RELAY-ORACLE.md)의 **1. VM 만들기**, **2. 방화벽 열기(80·443)** 를 그대로 하세요.
Name만 `media-dl`로 바꾸면 됩니다. Shape는 `VM.Standard.A1.Flex`(1 OCPU / 6GB)를 권합니다(영상 합치기에 메모리가 필요).

## 2. 설치 (VM에 SSH로 접속해서 붙여 넣기)

```bash
# 2-1. VM 방화벽 80·443
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt-get update && sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

# 2-2. Node 22 · ffmpeg · Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg git debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# 2-3. yt-dlp (공식 단일 실행 파일) — ARM(A1)·x86 자동 선택
ARCH=$(uname -m); [ "$ARCH" = aarch64 ] && F=yt-dlp_linux_aarch64 || F=yt-dlp_linux
sudo curl -fL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$F"
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version

# 2-4. 코드 받기
sudo useradd --system --no-create-home mediadl || true
sudo git clone --depth 1 https://github.com/Ella1-crypto/Ella1-crypto.github.io.git /tmp/site
sudo mkdir -p /opt/media-dl
sudo cp -r /tmp/site/_workers/media-dl/. /opt/media-dl/
sudo chown -R mediadl:mediadl /opt/media-dl
```

## 3. 비밀번호 넣고 실행

비밀번호는 PC의 `settings.bat`와 **똑같이** 넣습니다.

```bash
# 3-1. 설정 파일
sudo tee /etc/media-dl.env >/dev/null <<'EOF'
ACCESS_TOKEN=여기에-PC와-같은-비밀번호
YTDLP=/usr/local/bin/yt-dlp
YTDLP_EXTRA=--js-runtimes node
COOKIES_FILE=/var/lib/media-dl/cookies.txt
ALLOWED_ORIGINS=https://ella1-crypto.github.io
PORT=8790
HOST=127.0.0.1
EOF
sudo chmod 600 /etc/media-dl.env

# 3-2. 서비스 + yt-dlp 매일 자동 업데이트
sudo cp /opt/media-dl/deploy/media-dl.service /opt/media-dl/deploy/yt-dlp-update.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now media-dl yt-dlp-update.timer
sudo systemctl status media-dl --no-pager      # active (running) 이면 성공

# 3-3. HTTPS 주소
IP_DASH=$(curl -s https://ifconfig.me | tr . -)
sed "s/RELAY_HOST/$IP_DASH/" /opt/media-dl/deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
echo "다운로더 서버 주소: https://$IP_DASH.sslip.io"
```

> 이 VM에 Caddy로 다른 사이트(예: 보유세맵 중계)가 이미 있다면 `tee`로 덮어쓰지 말고, `/etc/caddy/Caddyfile` 끝에 블록을 덧붙이세요.

## 4. 쿠키 넣기 (Instagram은 거의 필수, YouTube는 권장)

서버에는 브라우저가 없으므로 PC에서 쿠키 파일을 만들어 올립니다.

1. PC의 Firefox에서 instagram.com, youtube.com에 로그인합니다.
2. PC PowerShell에서 쿠키 파일을 만듭니다.
   ```powershell
   yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download "https://www.youtube.com/watch?v=jNQXAC9IVRw"
   ```
3. 서버로 보냅니다(키 파일 경로와 IP는 바꿔서).
   ```powershell
   scp -i C:\Users\SJ9\Downloads\ssh-key.key cookies.txt ubuntu@1.2.3.4:/tmp/
   ```
4. 서버에서 자리를 옮깁니다.
   ```bash
   sudo install -o mediadl -g mediadl -m 600 /tmp/cookies.txt /var/lib/media-dl/cookies.txt && rm /tmp/cookies.txt
   sudo systemctl restart media-dl
   ```

쿠키는 몇 주~몇 달 뒤 만료됩니다. "로그인이 필요한 게시물…" 오류가 Oracle에서 계속 나면 이 단계를 다시 하세요.
(그동안에도 PC가 켜져 있으면 페이지가 PC로 자동 전환되니 다운로드는 됩니다.)

> 쿠키 파일은 로그인 정보와 같습니다. 서버의 `/var/lib/media-dl/`(권한 600)에만 두고, 저장소에 올리거나 남에게 보내지 마세요.
> 계정 차단이 걱정되면 인스타 **부계정**으로 로그인해서 쿠키를 만드세요.

## 5. 연결

1. PC의 `settings.bat`에 `PRIMARY_URL=https://1-2-3-4.sslip.io` (위에서 나온 주소)를 넣습니다.
2. PC에서 `start.bat`를 다시 실행 → "Oracle 서버에 PC 주소를 등록했습니다"가 나오면 성공.
3. 다운로더 페이지 **서버 설정**의 서버 주소에 Oracle 주소(`https://1-2-3-4.sslip.io`)를 넣습니다. 이제 이 주소는 다시 바꿀 일이 없습니다.

## 운영 메모

- **코드 업데이트**: `cd /tmp/site && sudo git pull && sudo cp -r _workers/media-dl/. /opt/media-dl/ && sudo chown -R mediadl:mediadl /opt/media-dl && sudo systemctl restart media-dl`
- **로그**: `journalctl -u media-dl -n 50`
- **비용**: Always Free 범위 0원. 오래 안 쓰면 VM이 회수될 수 있으니 회수 안내 메일이 오면 Pay As You Go로 바꾸세요(무료 한도 안에서는 계속 0원).
- **보안**: Node는 127.0.0.1에서만 듣고 Caddy(HTTPS)만 밖으로 열립니다. 비밀번호가 맞아야 작동하고, 지원 사이트 주소만 받습니다.
