@echo off
rem 이 파일을 settings.bat 로 복사해서 쓰세요. settings.bat 는 git에 올라가지 않습니다.
rem 비밀번호: 16자 이상. Oracle 서버와 PC 서버에 똑같이 넣습니다.
set ACCESS_TOKEN=여기에-16자-이상-비밀번호를-넣으세요
rem Oracle 서버 주소 (ORACLE.md 마지막 단계에서 나온 주소). 비워 두면 PC만 씁니다.
set PRIMARY_URL=https://1-2-3-4.sslip.io
rem 로그인이 필요한 Instagram·YouTube용. Firefox에서 로그인해 두는 게 가장 잘 됩니다.
set COOKIES_BROWSER=firefox
rem YouTube 보안 문제 풀이에 Node를 씀 (YouTube가 안 되면 이 줄을 지워 보세요)
set YTDLP_EXTRA=--js-runtimes node
