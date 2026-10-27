"""승인 링크로 받은 code를 Threads 60일 토큰으로 바꿔 GitHub Secret에 바로 저장한다.

토큰 생성기 버튼이 막힐 때 쓰는 길이다. GitHub Actions(.github/workflows/threads-oauth.yml)가 실행한다.
1) code → 1시간 토큰 2) 1시간 토큰 → 60일 토큰 3) 계정 이름 확인 4) Secret 저장.
토큰과 앱 시크릿은 화면·기록에 남기지 않는다(로그 가림 처리). code는 1회용이고 1시간 뒤 만료된다.
필요한 Secrets: THREADS_APP_SECRET, GH_SECRETS_PAT. 앱 ID는 공개값이라 워크플로에 적어 둔다.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Callable

from jaetech_publish import ThreadsError, http_json
from refresh_token import Encrypt, GitHubCall, Http, github_call, sealed_box_encrypt, update_secret

REDIRECT_URI = "https://ella1-crypto.github.io/"
# 승인할 계정 이름 → 저장할 Secret 이름. 다른 계정 토큰을 엉뚱한 Secret에 넣지 않게 묶어 둔다.
ACCOUNTS = {
    "pick.haru__1": "PICKHARU_THREADS_ACCESS_TOKEN",
}


def clean_code(raw: str) -> str:
    """주소 전체를 붙여 넣어도 code만 뽑는다. 끝에 붙는 '#_'도 뗀다."""
    match = re.search(r"[?&]code=([^&#\s]+)", raw)
    code = match.group(1) if match else raw.strip()
    return code.split("#", 1)[0].strip()


def exchange_code(code: str, app_id: str, app_secret: str, http: Http = http_json) -> str:
    short = http("POST", "https://graph.threads.net/oauth/access_token", {
        "client_id": app_id, "client_secret": app_secret, "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI, "code": code,
    }).get("access_token", "")
    if not short:
        raise ThreadsError("code를 토큰으로 바꾸지 못했습니다(만료됐거나 이미 쓴 code일 수 있음)")
    long = http("GET", "https://graph.threads.net/access_token", {
        "grant_type": "th_exchange_token", "client_secret": app_secret, "access_token": short,
    }).get("access_token", "")
    if not long:
        raise ThreadsError("60일 토큰으로 바꾸지 못했습니다")
    return long


def username_of(token: str, http: Http = http_json) -> str:
    return http("GET", "https://graph.threads.net/v1.0/me",
                {"fields": "id,username", "access_token": token}).get("username", "")


def run(account: str, code: str, app_id: str, app_secret: str, repo: str, gh: GitHubCall,
        http: Http = http_json, encrypt: Encrypt = sealed_box_encrypt,
        mask: Callable[[str], None] = lambda s: None) -> str:
    secret_name = ACCOUNTS.get(account)
    if not secret_name:
        raise ValueError(f"등록되지 않은 계정입니다: {account}")
    token = exchange_code(clean_code(code), app_id, app_secret, http)
    mask(token)
    actual = username_of(token, http)
    if actual != account:
        raise ThreadsError(f"승인한 계정이 {account}이 아니라 {actual}입니다. 저장하지 않았습니다.")
    update_secret(repo, token, gh, encrypt, name=secret_name)
    return f"{account} 토큰을 {secret_name}에 저장했습니다(60일 유효)."


def main() -> int:
    env = {k: os.environ.get(k, "").strip() for k in
           ("ACCOUNT", "OAUTH_CODE", "THREADS_APP_ID", "THREADS_APP_SECRET", "GH_SECRETS_PAT", "GITHUB_REPOSITORY")}
    missing = [k for k, v in env.items() if not v]
    if missing:
        print(f"값이 없습니다: {', '.join(missing)}", file=sys.stderr)
        return 1
    try:
        print(run(env["ACCOUNT"], env["OAUTH_CODE"], env["THREADS_APP_ID"], env["THREADS_APP_SECRET"],
                  env["GITHUB_REPOSITORY"], github_call(env["GH_SECRETS_PAT"]),
                  mask=lambda s: print(f"::add-mask::{s}")))
    except (ThreadsError, ValueError) as error:
        print(f"실패: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
