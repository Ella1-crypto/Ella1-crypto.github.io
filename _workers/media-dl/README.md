# 미디어 다운로더 — 내 PC에서 돌리기

YouTube·Instagram·Threads·TikTok 주소를 넣으면 영상(MP4)이나 소리(MP3)를 내려받는 개인용 도구입니다.

```
폰/PC 브라우저 (ella1-crypto.github.io/downloader/)
  → https://xxxx.trycloudflare.com   (Cloudflare Tunnel, 무료·가입 불필요)
  → 내 PC 127.0.0.1:8790             (node server.mjs)
  → yt-dlp → YouTube / Instagram …
```

YouTube·Instagram은 클라우드 서버 IP를 자주 막습니다. 집 PC는 가정용 IP라서 가장 잘 됩니다.

**두 서버를 함께 씁니다**
- **Oracle 무료 서버 (24시간)**: 평소에 씀. 설치는 [ORACLE.md](ORACLE.md)
- **내 PC (이 문서)**: Oracle이 막히면(주로 YouTube 봇 확인) 페이지가 자동으로 PC로 다시 시도. PC가 켜질 때 자기 주소를 Oracle에 알려 두므로 주소를 따로 넣을 필요 없음

PC만 쓰려면 `PRIMARY_URL`을 비워 두고 페이지에 PC 주소를 넣으면 됩니다.

## 1. 처음 한 번만 설치 (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
winget install Cloudflare.cloudflared
```

설치 후 PowerShell을 껐다 켜고 확인합니다.

```powershell
node -v; yt-dlp --version; ffmpeg -version; cloudflared --version
```

## 2. 비밀번호 정하기

1. 이 폴더의 `settings.example.bat`를 복사해서 이름을 `settings.bat`로 바꿉니다.
2. 메모장으로 열어 `ACCESS_TOKEN=` 뒤에 16자 이상 비밀번호를 넣습니다.
3. Instagram은 로그인이 필요한 경우가 많습니다. **Firefox**에서 인스타에 로그인해 두고 `COOKIES_BROWSER=firefox`를 그대로 둡니다.
4. Oracle 서버를 만들었다면 `PRIMARY_URL=`에 그 주소를 넣습니다.

`settings.bat`는 git에 올라가지 않습니다(`.gitignore`).

## 3. 켜기

`start.bat`를 더블클릭합니다.

- 창에 `media-dl on http://127.0.0.1:8790`와 `PC 서버 주소: https://어쩌구.trycloudflare.com`이 나옵니다.
- `PRIMARY_URL`을 넣었다면 "Oracle 서버에 PC 주소를 등록했습니다"가 이어서 나옵니다.

**PC를 켤 때마다 자동으로 켜기**: `install-autostart.bat`를 한 번 더블클릭하면 됩니다(최소화된 창으로 실행). 해제는 안내에 나온 파일을 지우면 됩니다.

## 4. 페이지에 연결

1. https://ella1-crypto.github.io/downloader/ 를 엽니다(폰에서도 됩니다).
2. **서버 설정**에 Oracle 주소(PC만 쓰면 trycloudflare 주소)와 비밀번호를 넣고 **저장하고 연결 확인**을 누릅니다.
3. 주소를 붙여 넣고 **가져오기** → **영상 (MP4)** / **소리만 (MP3)**.

> trycloudflare 주소는 `start.bat`를 켤 때마다 바뀝니다. Oracle 서버를 쓰면 자동으로 등록되니 신경 쓸 필요 없습니다.
> PC만 쓴다면 바뀔 때마다 서버 설정에 다시 넣어야 합니다.

## 잘 안 될 때

| 증상 | 해결 |
|---|---|
| "서버가 꺼져 있어요" | Oracle: `sudo systemctl status media-dl` / PC: `start.bat` 창이 켜져 있는지 확인 |
| "…(PC 서버도 꺼져 있어요)" | Oracle이 막혔는데 PC도 꺼진 상태. PC를 켜거나 Oracle 쿠키를 새로 넣기(ORACLE.md 4단계) |
| 정보는 나오는데 다운로드 버튼에서 오류 | 드물게 정보 조회와 실제 다운로드 사이에 막히는 경우. 다시 **가져오기** |
| "로그인이 필요한 게시물…" | Firefox에서 인스타/유튜브 로그인 후 서버 창을 닫고 `start.bat` 다시 실행 |
| "yt-dlp를 최신으로…" | 사이트가 바뀐 경우가 많습니다. `yt-dlp -U` (start.bat가 켤 때마다 자동으로 함) |
| 사진만 있는 인스타 게시물 | 아직 지원하지 않음(영상 위주) |
| Threads | yt-dlp의 Threads 지원은 불완전해서 안 되는 게시물이 있습니다 |

## 보안

- 서버는 `127.0.0.1`에만 열리고, 바깥에서는 터널을 통해서만 들어옵니다.
- 비밀번호가 맞아야 작동하고, 지원 사이트(YouTube·Instagram·Threads·TikTok) 주소만 받습니다.
- 다운로드 버튼 주소에 비밀번호가 들어갑니다. 링크를 남에게 공유하지 마세요.
- 다운로드한 파일은 개인 소장용으로만 쓰세요. 남의 영상을 다시 올리면 저작권 문제가 됩니다.
