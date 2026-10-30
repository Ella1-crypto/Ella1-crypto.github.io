"""저장된 인스타 토큰(PICKHARU_IG_ACCESS_TOKEN)이 어떤 계정에 쓸 수 있는지 여러 길로 물어보고 결과만 적는다.

ig_oauth.py가 계정을 못 찾았을 때 쓴다. 게시나 저장은 하지 않는다. 토큰은 기록에 남기지 않는다.
GitHub Actions(.github/workflows/ig-check.yml)가 실행하고, 결과는 ig-check-result.txt로 남긴다.
"""
from __future__ import annotations

import os
import sys

from ig_oauth import ACCOUNT, GRAPH, IG_GRAPH
from jaetech_publish import ThreadsError, http_json
from refresh_token import Http

IG_ASSET_ID = "17841426433649539"  # 비즈니스 설정 Instagram 계정 화면에 보인 pick.haru.daily 게시용 ID (2026-10-30; 로그인 화면의 1421…은 게시용이 아니었음)
BUSINESS_ID = "1098425316399267"  # pick.haru 비즈니스 포트폴리오


def probes() -> list[tuple[str, str, dict]]:
    return [
        ("인스타 ID 직접", f"{GRAPH}/{IG_ASSET_ID}", {"fields": "id,username"}),
        ("인스타 ID 직접(id만)", f"{GRAPH}/{IG_ASSET_ID}", {"fields": "id"}),
        ("게시 한도", f"{GRAPH}/{IG_ASSET_ID}/content_publishing_limit", {"fields": "quota_usage,config"}),
        ("시스템 사용자 할당 자산", f"{GRAPH}/me/assigned_business_asset_groups", {}),
        ("포트폴리오 클라이언트 인스타", f"{GRAPH}/{BUSINESS_ID}/client_instagram_accounts", {"fields": "id,username"}),
        ("포트폴리오 소유 인스타", f"{GRAPH}/{BUSINESS_ID}/owned_instagram_accounts", {"fields": "id,username"}),
        ("포트폴리오 인스타(구)", f"{GRAPH}/{BUSINESS_ID}/instagram_accounts", {"fields": "id,username"}),
        ("토큰 주인", f"{GRAPH}/me", {"fields": "id,name"}),
        ("페이지 연결 인스타", f"{GRAPH}/me/accounts", {"fields": "instagram_business_account{id,username}"}),
        ("인스타 호스트", f"{IG_GRAPH}/me", {"fields": "user_id,username"}),
    ]


def granted_targets(token: str, app_id: str, app_secret: str, http: Http = http_json) -> tuple[list[str], set[str]]:
    """debug_token으로 권한별 대상 계정 ID를 본다. 게시용 인스타 계정 ID는 여기 target_ids에 나온다."""
    data = http("GET", f"{GRAPH}/debug_token",
                {"input_token": token, "access_token": f"{app_id}|{app_secret}"}).get("data", {})
    lines, targets = [], set()
    for scope in data.get("granular_scopes", []):
        ids = scope.get("target_ids", [])
        targets.update(ids)
        lines.append(f"[권한] {scope.get('scope')}: {', '.join(ids) or '대상 전체'}")
    lines.append(f"[토큰] 종류 {data.get('type')}, 유효 {data.get('is_valid')}, 만료 {data.get('expires_at')}")
    return lines, targets


def check(token: str, http: Http = http_json, app_id: str = "", app_secret: str = "") -> list[str]:
    lines = []
    if app_id and app_secret:
        try:
            scope_lines, targets = granted_targets(token, app_id, app_secret, http)
            lines += scope_lines
            for target in sorted(targets):
                try:
                    body = http("GET", f"{GRAPH}/{target}", {"fields": "id,username", "access_token": token})
                    lines.append(f"[성공] 대상 {target}: {body}")
                except ThreadsError as error:
                    lines.append(f"[실패] 대상 {target}: {error}")
        except ThreadsError as error:
            lines.append(f"[실패] 토큰 검사: {error}")
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
    print("\n".join(check(token, app_id=os.environ.get("IG_APP_ID", "").strip(),
                          app_secret=os.environ.get("IG_APP_SECRET", "").strip())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
