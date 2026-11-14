@echo off
chcp 65001 >nul
rem PC를 켜면 start.bat가 최소화된 창으로 자동 실행되게 시작 프로그램에 등록합니다.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\media-dl.bat" echo @start "media-dl" /min cmd /c "%~dp0start.bat"
echo 등록했습니다: %STARTUP%\media-dl.bat
echo 해제하려면 위 파일을 지우세요.
pause
