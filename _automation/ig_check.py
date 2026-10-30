"""저장된 인스타 토큰(PICKHARU_IG_ACCESS_TOKEN)이 어떤 계정에 쓸 수 있는지 여러 길로 물어보고 결과만 적는다.

ig_oauth.py가 계정을 못 찾았을 때 쓴다. 게시나 저장은 하지 않는다. 토큰은 기록에 남기지 않는다.
GitHub Actions(.github/workflows/ig-check.yml)가 실행한다.
"""
from __future__ import annotations

import os
import sys

from ig_oauth import ACCOUNT, GRAPH, IG_GRAPH
from jaetech_publish import ThreadsError, http_json
from refresh_token import Http

IG_ASSET_ID = "1421223791077339"  # 로그인 화면 '이 포트폴리오'에 보인 pick.haru.daily ID (2026-10-30)
BUSINESS_ID = "1098425316399267"  # pick.haru 비즈니스 포트폴리오


def probes() -> list[tuple[str, str, dict]]:
    return [
        ("인스타 ID 직접", f"{GRAPH}/{IG_ASSET_ID}", {"fields": "id,username"}),
        ("포트폴리오 소유 인스타", f"{GRAPH}/{BUSINESS_ID}/owned_instagram_accounts", {"fields": "id,username"}),
        ("포트폴리오 인스타(구)", f"{GRAPH}/{BUSINESS_ID}/instagram_accounts", {"fields": "id,username"}),
        ("토큰 주인", f"{GRAPH}/me", {"fields": "id,name"}),
        ("페이지 연결 인스타", f"{GRAPH}/me/accounts", {"fields": "instagram_business_account{id,username}"}),
        ("인스타 호스트", f"{IG_GRAPH}/me", {"fields": "user_id,username"}),
    ]


def check(token: str, http: Http = http_json) -> list[str]:
    lines = []
    for label, url, params in probes():
        try:
            body = http("GET", url, {**params, "access_token": token})
            body.pop("paging", None)
            lines.append(f"[성공] {label}: {body}")
        except ThreadsError as error:
            lines.append(f"[실패] {label}: {error}")
    hit = [line for line in lines if line.startswith("[성공]") and ACCOUNT in line]
    lines.append(f"결론: {ACCOUNT} {'보임' if hit else '안 보임'}")
    return lines


def main() -> int:
    token = os.environ.get("IG_TOKEN", "").strip()
    if not token:
        print("값이 없습니다: PICKHARU_IG_ACCESS_TOKEN", file=sys.stderr)
        return 1
    print("\n".join(check(token)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
