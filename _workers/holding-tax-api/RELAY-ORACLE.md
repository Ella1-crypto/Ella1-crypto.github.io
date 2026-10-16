# 보유세맵 중계 서버 — Oracle Cloud 무료 VM에 올리기

VWorld는 Cloudflare 서버 IP를 막지만 국내 IP는 막지 않습니다. 2026-10-16에 이 PC(국내 IP)에서 `server.mjs`를 실행해 보니 역삼동 필지의 **2026년 공시지가**가 정상으로 들어왔습니다. 그래서 Oracle 무료 VM(국내 리전)에서 같은 코드를 돌리면 됩니다.

```
브라우저(ella1-crypto.github.io)
  → https://<IP>.sslip.io (Caddy: HTTPS 자동 발급)
  → 127.0.0.1:8787 (node server.mjs — Worker와 같은 코드)
  → api.vworld.kr
```

도메인을 살 필요는 없습니다. `sslip.io`는 `1-2-3-4.sslip.io`를 IP `1.2.3.4`로 돌려주는 무료 DNS라서, Caddy가 그 이름으로 Let's Encrypt 인증서를 받을 수 있습니다.

---

## 0. 먼저 확인 — 홈 리전이 국내인가

Oracle 무료(Always Free) VM은 **가입할 때 고른 홈 리전**에서만 만들 수 있습니다.

1. https://cloud.oracle.com 에 로그인합니다.
2. 오른쪽 위 리전 이름을 확인합니다.
   - **South Korea Central (Seoul)** 또는 **South Korea North (Chuncheon)** 이면 그대로 진행합니다.
   - 다른 나라(일본·미국 등)이면 VWorld가 해외 IP를 막을 수 있습니다. 이 경우 "PC + Cloudflare Tunnel" 방식이 낫습니다. 알려 주시면 그 안내를 따로 드립니다.

## 1. VM 만들기 (약 10분)

1. 메뉴 ☰ → **Compute → Instances → Create instance**
2. Name: `holding-tax-relay`
3. **Image**: Canonical Ubuntu 24.04
4. **Shape**: `VM.Standard.E2.1.Micro`(Always Free) 또는 `VM.Standard.A1.Flex`(1 OCPU / 6GB, Always Free)
   - "Out of capacity"가 나오면 다른 Shape를 고르거나 몇 시간 뒤 다시 시도합니다.
5. **Networking**: 기본 VCN, **Assign a public IPv4 address** 체크
6. **Add SSH keys**: "Generate a key pair for me" → **개인 키 저장(Save private key)** 을 눌러 `ssh-key.key` 파일을 받아 둡니다.
7. **Create** → 상태가 RUNNING이 되면 **Public IP address** 를 메모합니다(예: `1.2.3.4`).

## 2. 방화벽 열기 (80·443)

Oracle은 방화벽이 두 겹입니다. 둘 다 열어야 합니다.

**① 클라우드 쪽(Security List)**

1. 인스턴스 화면 → **Primary VNIC의 Subnet** 링크 → **Security Lists** → Default Security List
2. **Add Ingress Rules**를 두 번 추가합니다.
   - Source CIDR `0.0.0.0/0`, TCP, Destination port `80`
   - Source CIDR `0.0.0.0/0`, TCP, Destination port `443`

**② VM 안쪽(iptables)** — 3단계에서 명령으로 엽니다.

## 3. VM에 접속해서 설치 (복사해서 붙여 넣기)

Windows PowerShell에서 접속합니다. 키 파일 경로와 IP는 바꿔 넣으세요.

```powershell
ssh -i C:\Users\SJ9\Downloads\ssh-key.key ubuntu@1.2.3.4
```

접속한 뒤 아래를 차례로 붙여 넣습니다.

```bash
# 3-1. VM 방화벽에 80·443 열기 (Oracle Ubuntu는 기본으로 막혀 있음)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt-get update && sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

# 3-2. Node 22 + Caddy 설치
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs debian-keyring debian-archive-keyring apt-transport-https git
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# 3-3. 코드 받기 (공개 저장소에서 이 폴더만)
sudo useradd --system --no-create-home relay || true
sudo git clone --depth 1 https://github.com/Ella1-crypto/Ella1-crypto.github.io.git /tmp/site
sudo mkdir -p /opt/holding-tax-api
sudo cp -r /tmp/site/_workers/holding-tax-api/. /opt/holding-tax-api/
sudo chown -R relay:relay /opt/holding-tax-api
```

## 4. 키 넣고 실행

VWorld 키는 **서버에만** 둡니다. 저장소에는 올리지 않습니다.

```bash
# 4-1. 비밀값 파일 (키는 VWorld 마이페이지의 인증키)
sudo tee /etc/holding-tax-relay.env >/dev/null <<'EOF'
VWORLD_KEY=여기에_VWorld_인증키
VWORLD_DOMAIN=ella1-crypto.github.io
ALLOWED_ORIGINS=https://ella1-crypto.github.io
PORT=8787
HOST=127.0.0.1
EOF
sudo chmod 600 /etc/holding-tax-relay.env

# 4-2. 서비스 등록 (재부팅해도 자동 실행)
sudo cp /opt/holding-tax-api/deploy/holding-tax-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now holding-tax-relay
sudo systemctl status holding-tax-relay --no-pager   # active (running) 이면 성공

# 4-3. HTTPS — 공인 IP 1.2.3.4 라면 RELAY_HOST 자리에 1-2-3-4
IP_DASH=$(curl -s https://ifconfig.me | tr . -)
sed "s/RELAY_HOST/$IP_DASH/" /opt/holding-tax-api/deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
echo "중계 서버 주소: https://$IP_DASH.sslip.io"
```

## 5. 확인

PC의 브라우저나 PowerShell에서 확인합니다.

```powershell
curl.exe -H "Origin: https://ella1-crypto.github.io" "https://1-2-3-4.sslip.io/search?q=역삼동 825"
```

`{"items":[{"title":"서울특별시 강남구 역삼동 825", ...` 가 나오면 성공입니다.

## 6. 계산기에 연결

`holding-tax/js/config.js`의 `API_BASE`에 위 주소를 넣고 배포하면 됩니다. 주소를 알려 주시면 제가 넣고 배포합니다.

```js
API_BASE: 'https://1-2-3-4.sslip.io',
```

---

## 운영 메모

- **비용**: Always Free 범위라 0원입니다. 무료 계정의 VM은 오랫동안 CPU 사용량이 매우 낮으면 회수될 수 있습니다. 회수 안내 메일이 오면 계정을 유료(Pay As You Go)로 바꾸면 됩니다. 무료 한도 안에서는 계속 0원입니다.
- **코드 업데이트**: `cd /tmp/site && sudo git pull && sudo cp -r _workers/holding-tax-api/. /opt/holding-tax-api/ && sudo systemctl restart holding-tax-relay`
- **로그**: `journalctl -u holding-tax-relay -n 50`
- **보안**: 키는 `/etc/holding-tax-relay.env`(권한 600)에만 있습니다. Node는 127.0.0.1에서만 듣고, 밖으로는 Caddy(HTTPS)만 열립니다. 허용 출처는 `ella1-crypto.github.io`뿐이고, IP당 분당 90회로 제한됩니다.
- **VWorld 서비스 URL**: 키에 등록한 서비스 URL은 `https://ella1-crypto.github.io` 그대로 두면 됩니다. 서버는 `domain=ella1-crypto.github.io`로 호출합니다.
