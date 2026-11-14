@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist settings.bat (
  echo settings.bat 파일이 없습니다. settings.example.bat 를 복사해서 settings.bat 로 이름을 바꾸고 비밀번호를 넣어 주세요.
  pause
  exit /b 1
)
call settings.bat
echo yt-dlp 업데이트 확인 중...
yt-dlp -U
start "media-dl 서버" cmd /k node server.mjs
echo.
echo 아래에 나오는 https://....trycloudflare.com 주소를 다운로더 페이지 [서버 설정]에 넣으세요.
echo 이 창을 닫으면 터널이 꺼집니다.
echo.
cloudflared tunnel --url http://localhost:8790
