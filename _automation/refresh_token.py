"""Threads 장기 토큰을 갱신하고 GitHub Secret(THREADS_ACCESS_TOKEN)을 새 값으로 바꾼다.

GitHub Actions가 매주 월요일 실행한다. 토큰은 60일 동안 유효하고, 발급 후 24시간이 지난 토큰은
갱신하면 다시 60일이 생긴다. 매주 갱신하면 만료되지 않는다.
필요한 Secrets: THREADS_ACCESS_TOKEN, GH_SECRETS_PAT(이 저장소 Secrets 쓰기 권한의 fine-grained 토큰).
새 토큰은 화면·기록에 남기지 않는다(로그 가림 처리).
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Callable

from jaetech_publish import ThreadsError, check_token, http_json

SECRET_NAME = "THREADS_ACCESS_TOKEN"
GITHUB_API = "https://api.github.com"

Http = Callable[[str, str, dict], dict]
GitHubCall = Callable[[str, str, dict | None], dict]
Encrypt = Callable[[str, str], str]


def refresh_threads_token(token: str, http: Http = http_json) -> tuple[str, int]:
    result = http("GET", "https://graph.threads.net/refresh_access_token",
                  {"grant_type": "th_refresh_token", "access_token": token})
    new_token = result.get("access_token", "")
    if not new_token:
        raise ThreadsError("갱신 응답에 토큰이 없습니다")
    return new_token, int(result.get("expires_in", 0))


def github_call(pat: str) -> GitHubCall:
    def call(method: str, path: str, body: dict | None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{GITHUB_API}{path}", data=data, method=method, headers={
            "Authorization": f"Bearer {pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            hint = " (GH_SECRETS_PAT 권한·만료 확인)" if error.code in (401, 403, 404) else ""
            raise RuntimeError(f"GitHub API HTTP {error.code}{hint}") from None
    return call


def sealed_box_encrypt(public_key_b64: str, value: str) -> str:
    from nacl import encoding, public  # GitHub Actions에서 pip install pynacl
    key = public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder())
    return base64.b64encode(public.SealedBox(key).encrypt(value.encode())).decode()


def update_secret(repo: str, value: str, gh: GitHubCall, encrypt: Encrypt = sealed_box_encrypt) -> None:
    key = gh("GET", f"/repos/{repo}/actions/secrets/public-key", None)
    gh("PUT", f"/repos/{repo}/actions/secrets/{SECRET_NAME}",
       {"encrypted_value": encrypt(key["key"], value), "key_id": key["key_id"]})


def run(token: str, repo: str, gh: GitHubCall, http: Http = http_json,
        encrypt: Encrypt = sealed_box_encrypt, mask: Callable[[str], None] = lambda s: None) -> str:
    new_token, expires_in = refresh_threads_token(token, http)
    mask(new_token)
    check_token(new_token, http)  # 새 토큰이 같은 계정인지 확인한 뒤에만 바꾼다
    update_secret(repo, new_token, gh, encrypt)
    return f"토큰 갱신 완료 — 앞으로 {expires_in // 86400}일 유효"


def main() -> int:
    token = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
    pat = os.environ.get("GH_SECRETS_PAT", "").strip()
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not pat:
        print("::warning::GH_SECRETS_PAT Secret이 없어 토큰 자동 갱신을 건너뜁니다.")
        return 0
    if not token or not repo:
        print("THREADS_ACCESS_TOKEN 또는 GITHUB_REPOSITORY가 없습니다.", file=sys.stderr)
        return 1
    print(run(token, repo, github_call(pat), mask=lambda s: print(f"::add-mask::{s}")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
