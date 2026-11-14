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
echo.
echo 이 창을 닫으면 PC 서버가 꺼집니다. (최소화해 두면 됩니다)
echo.
node launcher.mjs
pause
