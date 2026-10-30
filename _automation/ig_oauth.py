"""로그인 URL로 받은 code를 인스타그램(@pick.haru.daily) 게시용 토큰으로 바꿔 GitHub Secret에 바로 저장한다.

Meta 앱 "pick.haru__1 publisher"의 Instagram API(통합 로그인, 비즈니스용 Facebook 로그인 구성)에서 쓴다.
GitHub Actions(.github/workflows/ig-oauth.yml)가 실행한다.
1) code → 토큰 (짧은 사용자 토큰이면 60일 토큰으로 한 번 더 바꿈) 2) 연결된 인스타 계정 확인 3) Secret 저장.
토큰과 앱 시크릿은 화면·기록에 남기지 않는다. 인스타 계정 숫자 ID는 공개값이라 결과에 적는다.
필요한 Secrets: PICKHARU_IG_APP_SECRET, GH_SECRETS_PAT.
"""
from __future__ import annotations

import os
import sys
from typing import Callable

from jaetech_publish import ThreadsError, http_json
from refresh_token import Encrypt, GitHubCall, Http, github_call, sealed_box_encrypt, update_secret
from threads_oauth import REDIRECT_URI, clean_code, secret_shape_problem

GRAPH = "https://graph.facebook.com/v21.0"
IG_GRAPH = "https://graph.instagram.com/v21.0"
ACCOUNT = "pick.haru.daily"
SECRET_NAME = "PICKHARU_IG_ACCESS_TOKEN"
SHORT_TOKEN_SECONDS = 7 * 24 * 3600  # 이보다 짧게 남은 토큰은 60일 토큰으로 바꾼다


def exchange_code(code: str, app_id: str, app_secret: str, http: Http = http_json) -> str:
    body = http("GET", f"{GRAPH}/oauth/access_token", {
        "client_id": app_id, "client_secret": app_secret, "redirect_uri": REDIRECT_URI, "code": code,
    })
    token = body.get("access_token", "")
    if not token:
        raise ThreadsError("code를 토큰으로 바꾸지 못했습니다(만료됐거나 이미 쓴 code일 수 있음)")
    expires = body.get("expires_in")
    if expires is None or int(expires) >= SHORT_TOKEN_SECONDS:  # 시스템 사용자 토큰은 만료 없음
        return token
    long = http("GET", f"{GRAPH}/oauth/access_token", {
        "grant_type": "fb_exchange_token", "client_id": app_id, "client_secret": app_secret,
        "fb_exchange_token": token,
    }).get("access_token", "")
    return long or token


def find_accounts(token: str, http: Http = http_json) -> list[tuple[str, str, str]]:
    """(사용자 이름, 숫자 ID, 찾은 곳). 통합 로그인 토큰이 어느 길로 계정을 보여 줄지 몰라 두 길을 다 본다."""
    found = []
    try:
        pages = http("GET", f"{GRAPH}/me/accounts",
                     {"fields": "instagram_business_account{id,username}", "access_token": token})
        for page in pages.get("data", []):
            account = page.get("instagram_business_account") or {}
            if account.get("id"):
                found.append((account.get("username", ""), account["id"], "graph.facebook.com"))
    except ThreadsError:
        pass
    try:
        me = http("GET", f"{IG_GRAPH}/me", {"fields": "user_id,username", "access_token": token})
        if me.get("user_id"):
            found.append((me.get("username", ""), str(me["user_id"]), "graph.instagram.com"))
    except ThreadsError:
        pass
    return found


def run(code: str, app_id: str, app_secret: str, repo: str, gh: GitHubCall,
        http: Http = http_json, encrypt: Encrypt = sealed_box_encrypt,
        mask: Callable[[str], None] = lambda s: None) -> str:
    token = exchange_code(clean_code(code), app_id, app_secret, http)
    mask(token)
    found = find_accounts(token, http)
    mine = [f for f in found if f[0] == ACCOUNT]
    if found and not mine:
        names = ", ".join(f[0] or f[1] for f in found)
        raise ThreadsError(f"{ACCOUNT}가 아니라 {names} 계정이 연결됐습니다. 저장하지 않았습니다.")
    update_secret(repo, token, gh, encrypt, name=SECRET_NAME)
    if not mine:
        return f"토큰을 {SECRET_NAME}에 저장했습니다. 다만 연결된 인스타 계정은 확인 못함 — 게시 전에 한 번 더 확인 필요."
    _, ig_id, host = mine[0]
    return f"{ACCOUNT} 토큰을 {SECRET_NAME}에 저장했습니다. 인스타 계정 ID {ig_id} ({host}에서 확인)."


def main() -> int:
    env = {k: os.environ.get(k, "").strip() for k in
           ("OAUTH_CODE", "IG_APP_ID", "IG_APP_SECRET", "GH_SECRETS_PAT", "GITHUB_REPOSITORY")}
    missing = [k for k, v in env.items() if not v]
    if missing:
        print(f"값이 없습니다: {', '.join(missing)}", file=sys.stderr)
        return 1
    problem = secret_shape_problem(env["IG_APP_SECRET"])
    if problem:  # 잘못된 시크릿으로 1회용 code를 쓰기 전에 멈춘다
        print(f"실패: {problem.replace('Threads', 'Meta')}", file=sys.stderr)
        return 1
    try:
        print(run(env["OAUTH_CODE"], env["IG_APP_ID"], env["IG_APP_SECRET"], env["GITHUB_REPOSITORY"],
                  github_call(env["GH_SECRETS_PAT"]), mask=lambda s: print(f"::add-mask::{s}")))
    except ThreadsError as error:
        print(f"실패: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
