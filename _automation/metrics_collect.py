"""4개 SNS 계정 성과 수집기 — 큐에 '올림'으로 남은 글의 조회·반응을 API로 받아 날짜별로 저장한다.

사용:
  python3 metrics_collect.py [--env-file PATH] [--accounts ig-pickharu,threads-heeya,threads-pickharu]
                             [--days 45] [--date YYYY-MM-DD] [--commit] [--dry-run]

계정(토큰은 환경변수로만 받고 어디에도 기록하지 않는다):
  ig-pickharu      Instagram @pick.haru.daily  — PICKHARU_IG_ACCESS_TOKEN(없으면 META_IG_READ_TOKEN), PICKHARU_IG_USER_ID(선택)
  threads-heeya    Threads @heeya.dailyfit     — THREADS_ACCESS_TOKEN, THREADS_USER_ID(선택)
  threads-pickharu Threads @pick.haru__1       — PICKHARU_THREADS_ACCESS_TOKEN
토큰이 없는 계정은 건너뛰고 errors에 "토큰 없음"만 남긴다(맥에는 pick.haru 스레드 토큰이 없고, GitHub Actions에는 다 있다).

저장: _automation/metrics/daily/<날짜>/<계정>.json — 그날 그 계정의 스냅샷 하나(같은 날 다시 돌면 덮어씀).
  {"account", "handle", "collected_at", "profile": {...}, "posts": {큐 id: {media_id, format, published_at, permalink, metrics{...}}},
   "unmatched": [큐에 없는 글], "errors": [...]}
인스타는 큐의 post_id가 실제 미디어 ID가 아닐 때(컨테이너 ID가 들어간 경우, '직접 게시' 릴스)도 캡션 첫 줄·종류·시각으로 짝을 찾는다.
인스타 인사이트(reach·saved·shares·views…)는 토큰에 instagram_manage_insights 권한이 있어야 나온다. 없으면 like_count·comments_count만
받고 insights_error에 이유를 남긴다(권한을 받으면 그대로 다시 돌리면 된다).
표준 라이브러리만 쓴다. 게시·수정은 하지 않는다(큐 파일은 읽기만).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
HERE = Path(__file__).resolve().parent
SITE_ROOT = HERE.parent
METRICS_DIR = HERE / "metrics"
DAILY_DIR = METRICS_DIR / "daily"
IG_GRAPH = "https://graph.facebook.com/v21.0"
THREADS_GRAPH = "https://graph.threads.net/v1.0"
DEFAULT_IG_USER = "17841426433649539"  # pick.haru.daily 게시용 ID(공개값, pickharu_ig_publish.py와 같음)
PUBLISHED = {"올림", "직접 게시"}  # 큐에서 '올라간 글'로 치는 상태
IG_FEED_METRICS = ["reach", "saved", "shares", "likes", "comments", "total_interactions", "views",
                   "follows", "profile_visits", "profile_activity"]
IG_REEL_METRICS = ["reach", "saved", "shares", "likes", "comments", "total_interactions", "views",
                   "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"]
THREADS_POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"]
MATCH_WINDOW = timedelta(hours=36)  # 캡션으로 짝 맞출 때 예약 시각과 실제 게시 시각 차이 허용

ACCOUNTS = {
    "ig-pickharu": {"platform": "instagram", "handle": "pick.haru.daily", "queue": "pickharu-ig-queue.json",
                    "token_env": ["PICKHARU_IG_ACCESS_TOKEN", "META_IG_READ_TOKEN"], "user_env": "PICKHARU_IG_USER_ID"},
    "threads-heeya": {"platform": "threads", "handle": "heeya.dailyfit", "queue": "jaetech-queue.json",
                      "token_env": ["THREADS_ACCESS_TOKEN"], "user_env": "THREADS_USER_ID"},
    "threads-pickharu": {"platform": "threads", "handle": "pick.haru__1", "queue": "pickharu-queue.json",
                         "token_env": ["PICKHARU_THREADS_ACCESS_TOKEN"], "user_env": "PICKHARU_THREADS_USER_ID"},
}


class ApiError(Exception):
    pass


def scrub(text: str) -> str:
    """오류 문구에 토큰이 섞여 들어오면 지운다."""
    return re.sub(r"(access_token=)[^&\s]+", r"\1<hidden>", str(text))[:300]


def http_get(url: str, params: dict) -> dict:
    data = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{data}", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode()).get("error", {})
            raise ApiError(f"HTTP {error.code}: {scrub(body.get('message', ''))}") from None
        except (ValueError, AttributeError):
            raise ApiError(f"HTTP {error.code}") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise ApiError(f"연결 실패: {type(error).__name__}") from None


def load_env_file(path: Path) -> None:
    """KEY=VALUE 줄만 읽어 환경변수에 넣는다(이미 있는 값은 두고, 값은 어디에도 쓰지 않는다)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and not os.environ.get(key):
            os.environ[key] = value


def token_for(spec: dict) -> str:
    for name in spec["token_env"]:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    text = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", text)  # +0000 → +00:00
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=KST)


def first_line(text: str | None) -> str:
    for line in (text or "").splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            return line
    return ""


def item_time(item: dict) -> datetime | None:
    return parse_time(item.get("published_at")) or parse_time(item.get("publish_at"))


def published_items(queue: list[dict], since: datetime) -> list[dict]:
    out = []
    for item in queue:
        if item.get("status") not in PUBLISHED:
            continue
        when = item_time(item)
        if when and when >= since:
            out.append(item)
    return out


def ig_format(item: dict, media: dict | None) -> str:
    if media:
        if media.get("media_product_type") == "REELS":
            return "reel"
        return "carousel" if media.get("media_type") == "CAROUSEL_ALBUM" else "image"
    if item.get("video") or item.get("id", "").startswith("rl-"):
        return "reel"
    return "carousel" if len(item.get("images") or []) > 1 else "image"


# ---------- Instagram ----------

def ig_list_media(token: str, user_id: str, since: datetime) -> list[dict]:
    fields = "id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink"
    url = f"{IG_GRAPH}/{user_id}/media"
    params: dict = {"fields": fields, "limit": 50, "access_token": token}
    out: list[dict] = []
    for _ in range(10):
        body = http_get(url, params)
        data = body.get("data", [])
        out.extend(data)
        oldest = min((parse_time(m.get("timestamp")) for m in data if m.get("timestamp")), default=None)
        after = body.get("paging", {}).get("cursors", {}).get("after")
        if not data or not after or (oldest and oldest < since):
            break
        params["after"] = after
    return out


def ig_match(items: list[dict], media_list: list[dict]) -> tuple[dict[str, dict], list[dict]]:
    """큐 글 ↔ 인스타 미디어. post_id가 맞으면 그걸로, 아니면 캡션 첫 줄·종류·시각으로."""
    by_id = {m["id"]: m for m in media_list}
    overrides = load_overrides()
    matched: dict[str, dict] = {}
    used: set[str] = set()
    for item in items:
        media = by_id.get(overrides.get(item["id"]) or str(item.get("post_id") or ""))
        if media:
            matched[item["id"]] = media
            used.add(media["id"])
    for item in items:
        if item["id"] in matched:
            continue
        want_reel = ig_format(item, None) == "reel"
        line = first_line(item.get("caption"))
        when = item_time(item)
        best = None
        for media in media_list:
            if media["id"] in used or first_line(media.get("caption")) != line or not line:
                continue
            if (media.get("media_product_type") == "REELS") != want_reel:
                continue
            m_time = parse_time(media.get("timestamp"))
            if when and m_time and abs(m_time - when) > MATCH_WINDOW:
                continue
            best = media
            break
        if best:
            matched[item["id"]] = best
            used.add(best["id"])
    # 3차: 캡션이 조금 다른 '직접 게시' 글 — 같은 종류·시각 창 안에서 첫 줄 단어가 가장 많이 겹치는 것(0.2 이상)
    for item in items:
        if item["id"] in matched:
            continue
        want_reel = ig_format(item, None) == "reel"
        want = tokens(first_line(item.get("caption")))
        when = item_time(item)
        best, best_score = None, 0.0
        for media in media_list:
            if media["id"] in used or (media.get("media_product_type") == "REELS") != want_reel:
                continue
            m_time = parse_time(media.get("timestamp"))
            if not (when and m_time) or abs(m_time - when) > MATCH_WINDOW:
                continue
            have = tokens(first_line(media.get("caption")))
            score = len(want & have) / len(want | have) if want and have else 0.0
            if score > best_score:
                best, best_score = media, score
        if best and best_score >= 0.2:
            matched[item["id"]] = best
            used.add(best["id"])
    unmatched = [m for m in media_list if m["id"] not in used]
    return matched, unmatched


def tokens(line: str) -> set[str]:
    return {t for t in re.split(r"[\s,.!?·…:;()\[\]]+", line) if len(t) > 1}


def load_overrides() -> dict[str, str]:
    """metrics/id_overrides.json — {큐 id: 실제 미디어 id}. 자동 짝이 틀릴 때 손으로 적는다."""
    path = METRICS_DIR / "id_overrides.json"
    try:
        return {str(k): str(v) for k, v in json.loads(path.read_text(encoding="utf-8")).items()}
    except (OSError, ValueError):
        return {}


def ig_insights(token: str, media_id: str, metrics: list[str], state: dict) -> tuple[dict, str]:
    """한 글의 인사이트. 권한 오류(#10)는 계정 전체에 해당하니 한 번 보고 나면 다시 묻지 않는다."""
    if state.get("no_permission"):
        return {}, state["no_permission"]
    try:
        body = http_get(f"{IG_GRAPH}/{media_id}/insights", {"metric": ",".join(metrics), "access_token": token})
        return {d["name"]: insight_value(d) for d in body.get("data", [])}, ""
    except ApiError as error:
        message = str(error)
        if "(#10)" in message or "permission" in message.lower():
            state["no_permission"] = message
            return {}, message
    # 일부 지표만 지원하지 않는 경우: 하나씩
    out, errors = {}, []
    for metric in metrics:
        try:
            body = http_get(f"{IG_GRAPH}/{media_id}/insights", {"metric": metric, "access_token": token})
            for d in body.get("data", []):
                out[d["name"]] = insight_value(d)
        except ApiError as error:
            errors.append(f"{metric}: {error}")
    return out, "; ".join(errors)[:300]


def insight_value(entry: dict):
    if "total_value" in entry:
        return entry["total_value"].get("value")
    values = entry.get("values") or []
    return values[-1].get("value") if values else None


def collect_instagram(spec: dict, token: str, queue: list[dict], since: datetime) -> dict:
    user_id = os.environ.get(spec["user_env"], "").strip() or DEFAULT_IG_USER
    result: dict = {"profile": {}, "posts": {}, "unmatched": [], "errors": []}
    try:
        me = http_get(f"{IG_GRAPH}/{user_id}", {"fields": "id,username,followers_count,media_count", "access_token": token})
    except ApiError as error:
        result["errors"].append(f"계정 조회 실패: {error}")
        return result
    if me.get("username") != spec["handle"]:
        result["errors"].append(f"계정이 {spec['handle']}가 아님: {me.get('username')}")
        return result
    result["profile"] = {"followers": me.get("followers_count"), "media_count": me.get("media_count")}
    try:
        media_list = ig_list_media(token, user_id, since - MATCH_WINDOW)
    except ApiError as error:
        result["errors"].append(f"미디어 목록 실패: {error}")
        return result
    items = published_items(queue, since)
    matched, unmatched = ig_match(items, media_list)
    state: dict = {}
    for item in items:
        media = matched.get(item["id"])
        fmt = ig_format(item, media)
        entry = {"media_id": media["id"] if media else None, "format": fmt,
                 "published_at": (media or {}).get("timestamp") or item.get("published_at") or item.get("publish_at"),
                 "permalink": (media or {}).get("permalink"), "metrics": {}}
        if media:
            entry["metrics"] = {"likes": media.get("like_count"), "comments": media.get("comments_count")}
            metrics_wanted = IG_REEL_METRICS if fmt == "reel" else IG_FEED_METRICS
            insights, error = ig_insights(token, media["id"], metrics_wanted, state)
            entry["metrics"].update({k: v for k, v in insights.items() if v is not None})
            if error:
                entry["insights_error"] = error
        else:
            entry["not_found"] = "인스타 미디어 목록에서 못 찾음(지웠거나 보관함, 또는 캡션이 다름)"
        result["posts"][item["id"]] = entry
    result["unmatched"] = [{"media_id": m["id"], "format": "reel" if m.get("media_product_type") == "REELS" else "feed",
                            "published_at": m.get("timestamp"), "caption_first_line": first_line(m.get("caption"))[:60],
                            "permalink": m.get("permalink"), "metrics": {"likes": m.get("like_count"), "comments": m.get("comments_count")}}
                           for m in unmatched if (parse_time(m.get("timestamp")) or since) >= since]
    if state.get("no_permission"):
        result["errors"].append("인사이트 권한 없음(instagram_manage_insights 필요) — like/comments만 저장: " + state["no_permission"])
    return result


# ---------- Threads ----------

def threads_post_ids(item: dict) -> list[str]:
    ids = [str(item["post_id"])] if item.get("post_id") else []
    for extra in item.get("thread_ids") or []:
        if str(extra) not in ids:
            ids.append(str(extra))
    return ids


def collect_threads(spec: dict, token: str, queue: list[dict], since: datetime) -> dict:
    result: dict = {"profile": {}, "posts": {}, "unmatched": [], "errors": []}
    try:
        me = http_get(f"{THREADS_GRAPH}/me", {"fields": "id,username", "access_token": token})
    except ApiError as error:
        result["errors"].append(f"계정 조회 실패: {error}")
        return result
    if me.get("username") != spec["handle"]:
        result["errors"].append(f"계정이 {spec['handle']}가 아님: {me.get('username')}")
        return result
    user_id = os.environ.get(spec["user_env"], "").strip() or me["id"]
    try:
        body = http_get(f"{THREADS_GRAPH}/{user_id}/threads_insights", {"metric": "views,followers_count", "access_token": token})
        for d in body.get("data", []):
            if d["name"] == "followers_count":
                result["profile"]["followers"] = insight_value(d)
            elif d["name"] == "views":
                values = d.get("values") or []
                result["profile"]["profile_views_day"] = values[-1].get("value") if values else None
    except ApiError as error:
        result["errors"].append(f"계정 인사이트 실패: {error}")
    for item in published_items(queue, since):
        ids = threads_post_ids(item)
        if not ids:
            result["posts"][item["id"]] = {"media_id": None, "format": "text", "not_found": "post_id 없음",
                                           "published_at": item.get("published_at") or item.get("publish_at"), "metrics": {}}
            continue
        entry = {"media_id": ids[0], "format": threads_format(item), "published_at": item.get("published_at") or item.get("publish_at"),
                 "permalink": None, "metrics": {}}
        try:
            info = http_get(f"{THREADS_GRAPH}/{ids[0]}", {"fields": "id,permalink,media_type,timestamp", "access_token": token})
            entry["permalink"] = info.get("permalink")
            if info.get("timestamp"):
                entry["published_at"] = info["timestamp"]
        except ApiError as error:
            entry["not_found"] = str(error)
            result["posts"][item["id"]] = entry
            continue
        try:
            body = http_get(f"{THREADS_GRAPH}/{ids[0]}/insights", {"metric": ",".join(THREADS_POST_METRICS), "access_token": token})
            entry["metrics"] = {d["name"]: insight_value(d) for d in body.get("data", [])}
        except ApiError as error:
            entry["insights_error"] = str(error)
        if len(ids) > 1:  # 이어 쓴 글(thread_ids)은 조회수만 더해 둔다
            extra_views = 0
            for extra in ids[1:]:
                try:
                    body = http_get(f"{THREADS_GRAPH}/{extra}/insights", {"metric": "views", "access_token": token})
                    extra_views += int(insight_value(body["data"][0]) or 0) if body.get("data") else 0
                except (ApiError, KeyError, IndexError, TypeError):
                    pass
            entry["metrics"]["thread_extra_views"] = extra_views
        result["posts"][item["id"]] = entry
    return result


def threads_format(item: dict) -> str:
    if item.get("video"):
        return "video"
    if item.get("gif"):
        return "gif"
    if item.get("images") or item.get("image_url") or item.get("image_urls"):
        return "image"
    return "text"


# ---------- 저장·커밋 ----------

def snapshot_path(date: str, account: str) -> Path:
    return DAILY_DIR / date / f"{account}.json"


def save_snapshot(date: str, account: str, data: dict) -> Path:
    path = snapshot_path(date, account)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    return path


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=SITE_ROOT, capture_output=True, text=True)


def git_commit_push(message: str) -> str:
    git("add", "--", str(METRICS_DIR.relative_to(SITE_ROOT)))
    if git("diff", "--cached", "--quiet").returncode == 0:
        return "바뀐 내용 없음"
    if git("commit", "-m", message).returncode != 0:
        return "커밋 실패"
    if git("push").returncode == 0:
        return "푸시함"
    # 다른 커밋이 먼저 들어온 경우: 스냅샷 파일 충돌은 우리 쪽(새 수집)을 쓴다
    if git("pull", "--rebase", "-X", "theirs").returncode == 0 and git("push").returncode == 0:
        return "푸시함(rebase)"
    git("rebase", "--abort")
    return "푸시 실패(커밋은 로컬에 남음)"


def run(accounts: list[str], days: int, date: str, commit: bool, dry_run: bool) -> int:
    now = datetime.now(KST)
    since = now - timedelta(days=days)
    summary_lines = []
    for name in accounts:
        spec = ACCOUNTS[name]
        token = token_for(spec)
        queue_path = HERE / spec["queue"]
        queue = json.loads(queue_path.read_text(encoding="utf-8")) if queue_path.exists() else []
        if not token:
            summary_lines.append(f"{name}: 토큰 없음({' 또는 '.join(spec['token_env'])}) — 건너뜀")
            continue
        collector = collect_instagram if spec["platform"] == "instagram" else collect_threads
        data = collector(spec, token, queue, since)
        data = {"account": name, "handle": spec["handle"], "collected_at": now.isoformat(timespec="minutes"),
                "window_days": days, **data}
        got = sum(1 for p in data["posts"].values() if p.get("metrics"))
        line = f"{name}: 글 {len(data['posts'])}개 중 {got}개 수치 받음, 팔로워 {data['profile'].get('followers')}"
        if data["errors"]:
            line += f" | 문제 {len(data['errors'])}: " + " / ".join(data["errors"])[:200]
        summary_lines.append(line)
        if not dry_run:
            save_snapshot(date, name, data)
    print("\n".join(summary_lines))
    if commit and not dry_run:
        print(git_commit_push(f"metrics: {date} 성과 수집 ({', '.join(accounts)})"))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env-file", help="토큰을 읽을 .env 파일(값은 출력하지 않음)")
    parser.add_argument("--accounts", default=",".join(ACCOUNTS), help="쉼표로 구분: " + ", ".join(ACCOUNTS))
    parser.add_argument("--days", type=int, default=45, help="며칠 전 글까지 볼지(기본 45)")
    parser.add_argument("--date", default=datetime.now(KST).strftime("%Y-%m-%d"), help="스냅샷 날짜(기본 오늘 KST)")
    parser.add_argument("--commit", action="store_true", help="metrics/ 변경을 커밋·푸시")
    parser.add_argument("--dry-run", action="store_true", help="저장하지 않고 요약만")
    args = parser.parse_args(argv)
    if args.env_file:
        load_env_file(Path(args.env_file).expanduser())
    accounts = [a.strip() for a in args.accounts.split(",") if a.strip()]
    unknown = [a for a in accounts if a not in ACCOUNTS]
    if unknown:
        print(f"모르는 계정: {unknown}", file=sys.stderr)
        return 2
    return run(accounts, args.days, args.date, args.commit, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
