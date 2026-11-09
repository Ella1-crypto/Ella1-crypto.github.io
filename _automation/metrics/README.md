# 성과 수집 · 7일 테스트 보드 · 4계정 주간 보고 (2026-11-09)

"열심히 올리는데 뭐가 먹히는지 모르는 상태"를 끝내려고 만든 것. 큐에 '올림'으로 남은 글의 숫자를 매일 받아 쌓고,
예약 글에 "무엇을 실험하는 글인지" 태그를 붙여, 월요일마다 4계정 보고서로 묶는다. 게시·예약·캡션은 건드리지 않는다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `../metrics_collect.py` | 수집기. Instagram Graph API(@pick.haru.daily) · Threads API(@heeya.dailyfit, @pick.haru__1)에서 글별 수치를 받아 `daily/<날짜>/<계정>.json`에 저장 |
| `../metrics_test_tag.py` | 테스트 태그 CLI. 큐 항목에 `test: {group, variable, variant, hypothesis, kpi}`를 붙인다 |
| `../weekly_report.py` | 주간 보고서. `~/Documents/claude-work/reports/<날짜>-weekly.md` + 텔레그램 요약 `~/sns/pickharu/data/telegram/outbox/<날짜>-weekly.txt` |
| `daily/<YYYY-MM-DD>/<계정>.json` | 그날 스냅샷(계정: `ig-pickharu`, `threads-heeya`, `threads-pickharu`) |
| `tests/backfill-20261109.json` | 11/10~11/16 예약 글 태그 백필 명세(`metrics_test_tag.py batch`로 적용함) |
| `id_overrides.json` (선택) | `{"큐 id": "실제 미디어 id"}` — 자동 짝 맞추기가 틀릴 때 손으로 |
| `metrics-collect.yml` | GitHub Actions 워크플로 **본보기**(아래 "사용자가 할 일") |

## 수집 (`metrics_collect.py`)

```
cd ~/sns/Ella1-crypto.github.io/_automation
python3 metrics_collect.py --env-file ~/sns/content-automation/.env --accounts ig-pickharu,threads-heeya --commit
```
- 토큰은 환경변수로만: `PICKHARU_IG_ACCESS_TOKEN`(없으면 `META_IG_READ_TOKEN`), `THREADS_ACCESS_TOKEN`(+`THREADS_USER_ID`), `PICKHARU_THREADS_ACCESS_TOKEN`.
  맥의 `~/sns/content-automation/.env`에는 인스타 읽기 토큰과 heeya 스레드 토큰만 있다. pick.haru__1 스레드 토큰은 GitHub Secrets에만 있다.
- 범위: 최근 45일(`--days`) 안에 status가 `올림`·`직접 게시`인 큐 글. 같은 날 다시 돌면 그날 파일을 덮어쓴다.
- 인스타 짝 맞추기: 큐 `post_id`가 미디어 목록에 없으면(컨테이너 ID가 들어간 경우, 직접 올린 릴스) 캡션 첫 줄·종류(릴스/피드)·시각(±36시간)으로 찾고,
  그래도 없으면 첫 줄 단어 겹침 0.2 이상인 것. 큐에 없는 글은 `unmatched`에 남긴다(직접 올린 글).
- 스냅샷 모양: `posts[큐 id] = {media_id, format(reel|carousel|image|text|video|gif), published_at, permalink, metrics{...}, insights_error?, not_found?}`
  - Instagram 지표: `likes, comments` + (권한 있을 때) 피드 `reach, saved, shares, total_interactions, views, follows, profile_visits, profile_activity`,
    릴스 `reach, saved, shares, total_interactions, views, ig_reels_avg_watch_time, ig_reels_video_view_total_time`
  - Threads 지표: `views, likes, replies, reposts, quotes, shares` (+ 이어 쓴 글은 `thread_extra_views`)
  - `profile`: 팔로워 수, (Threads) 어제 프로필 조회 수
- `--commit`: `_automation/metrics/`만 커밋·푸시(충돌 시 새 수집 쪽을 씀). `--dry-run`: 저장 없이 요약만.

## 테스트 태그 (`metrics_test_tag.py`)

변수 `variable`: `hook_type | format | length | color | time`. 훅 유형 변형은 `①장면 ②숫자 ③반전 ④질문 ⑤고백 ⑥정리`(동그라미 숫자만 넣어도 된다).
KPI 기본: 인스타 `saves_shares_per_reach`((저장+공유)/도달), 스레드 `engage_per_view`((좋아요+답글+리포스트+인용+공유)/조회).

```
# 항목 하나 (큐는 ig | heeya | pickharu)
python3 metrics_test_tag.py tag ig ig-aitip-05-xxx --variable hook_type --variant ④ --group aitip-hook --hypothesis "구체 질문 훅이 숫자 훅보다 저장률이 높다" --commit
# studio script.json의 고른 훅(cover.title과 같은 hooks[].text)으로 자동
python3 metrics_test_tag.py auto ig ig-yt08-clean-20261111 --script "~/sns/Instagram pick.haru.daily/out/yt08-clean-20261111/script.json" --group yt-repost-hook --hypothesis "..." --commit
# 여러 개 한 번에
python3 metrics_test_tag.py batch metrics/tests/<명세>.json --commit
python3 metrics_test_tag.py show ig        # 태그 목록
python3 metrics_test_tag.py untag ig <id>  # 지우기
```
- 같은 `group` 안에서 `variant`끼리 비교된다. 비교 대상이 이미 올라간 글이어도 태그를 붙이면 된다(예: 틴트 룩 비교군).
- 예약 작업이 글을 넣을 때 태그도 같이 붙인다(`~/.claude/scheduled-tasks/ig-yearend-daily/SKILL.md` 9번에 적어 둠). 다른 작업(ai-knowhow-series·free-course-series 등)도 큐에 넣은 뒤 `auto` 또는 `tag` 한 줄이면 된다.
- 인스타 큐를 푸시하면 ig-pickharu 워크플로가 깨어나지만, 그 시각에 올릴 글이 없으면 바로 끝난다(발행 로직은 안 바뀜).

현재 태그(11/9 백필 44개): `yt-repost-hook`(연말정산 카드뉴스 ②/③/⑥), `yt-repost-hook-reel`, `aitip-hook`(②/④), `aitip-hook-reel`,
`ad-inpock-time`(광고 12:30 vs 20:30), `ad-inpock-time-reel`, `look-clean-vs-tint`(클린 vs 틴트, 비교군 3개 포함).
같은 내용의 카드뉴스(ig-X) vs 릴스(rl-X) 형식 비교는 태그 없이 보고서가 짝을 찾아 계산한다.

## 주간 보고 (`weekly_report.py`)

```
python3 weekly_report.py [--week-ending 2026-11-15] [--no-telegram] [--print]
```
- 지난주 월~일(KST). 계정별 글 수·팔로워(주 시작 대비)·TOP3/약한 글 3·수치 못 받은 글·큐 밖 글, 네이버 블로그는 RSS 목록(조회수 "앱에서 확인"),
  연재별(연말정산 · AI 노하우 · 무료강의 · 마음 10분 · 쇼핑·광고 · 세일 소식 · 일상), 테스트 보드 판정(변형마다 n≥2이고 1.2배 이상 차이면 "우세", 아니면 "차이 작음"/"표본 부족").
- 인스타 인사이트 권한이 없는 동안은 좋아요+댓글로 임시 계산하고 "임시"라고 적는다.
- 텔레그램 요약은 3,500자 이하. outbox 파일은 켜져 있는 `telegram_drafts.py serve`(스레드 승인 봇)가 30초 안에 보낸다.

## 예약 작업(맥, Claude Code)

| 작업 | 시각 | 하는 일 |
|---|---|---|
| launchd `com.sns.metrics-daily` | 매일 23:30 | `_automation/metrics_daily.sh`: `git pull --ff-only` → 수집(인스타·heeya) → 커밋·푸시. 로그 `metrics/collect.log`, 실패하면 텔레그램 outbox에 한 줄 |
| Claude 예약 작업 `pickharu-weekly-report` | 월 09:00 | pull → 수집 → `weekly_report.py` → 보고서 md + 텔레그램 outbox |

- 수집은 LLM 없이 셸 스크립트로 돈다(plist `~/sns/launchd/com.sns.metrics-daily.plist`, `launchctl list | grep metrics`로 확인, 바로 돌려 보기 `sh _automation/metrics_daily.sh`).
- 주간 보고 작업이 권한 대기에 걸리지 않게 `~/.claude/settings.json` allow에 수집·보고 명령을 미리 넣어 두었다.

## 빈 곳 · 사용자가 할 일

1. **인스타 인사이트(도달·저장·공유·조회)가 안 나온다.** 지금 토큰(시스템 사용자, 만료 없음)에는 `instagram_manage_insights` 권한이 없다.
   Meta 비즈니스 설정 → 시스템 사용자 → pickharu-bot → "자산 할당"의 Instagram 계정 권한에 **인사이트** 추가 → "토큰 생성"에서
   `instagram_basic, instagram_manage_insights, instagram_content_publish, instagram_manage_comments, pages_show_list` 로 새 토큰 →
   `~/sns/content-automation/.env`의 `META_IG_READ_TOKEN` 값 바꾸기(메모장으로, 채팅에 붙이지 않기). GitHub Secret `PICKHARU_IG_ACCESS_TOKEN`도 같은 토큰으로 바꾸면 좋다.
   바꾸고 나서 수집기를 다시 돌리면 그날부터 `reach·saved·shares·views`가 쌓인다(과거 글도 현재 누적값은 받는다).
2. **pick.haru__1 스레드 수치는 맥에서 못 받는다**(토큰이 GitHub Secrets에만 있음). 두 가지 중 하나:
   - (권장) 워크플로 등록: `_automation/metrics/metrics-collect.yml`을 `.github/workflows/metrics-collect.yml`로 옮겨 푸시한다. 맥의 gh 토큰에 workflow 범위가 없어서
     ```
     gh auth refresh -h github.com -s workflow
     ```
     를 한 번 한 뒤(브라우저 로그인) `git mv _automation/metrics/metrics-collect.yml .github/workflows/ && git commit -m "metrics: 수집 워크플로" && git push`.
     또는 GitHub 웹에서 Add file → 같은 내용으로 `.github/workflows/metrics-collect.yml` 만들기. 등록되면 매일 23:40 KST에 pick.haru__1만 받아 커밋한다.
   - 아니면 threads-oauth 워크플로로 토큰을 다시 받아 맥 `.env`에 `PICKHARU_THREADS_ACCESS_TOKEN=`으로 넣고, 예약 작업 명령의 `--accounts`에 `threads-pickharu`를 더한다.
3. **블로그 조회수는 API가 없다.** RSS로 글 목록만 받는다. 네이버 블로그 앱 통계에서 확인.
4. 쿠팡 파트너스 클릭·수익은 API가 없어 보고서에 없다(예전 주간 보고는 Chrome 화면을 읽었는데 로그인 상태에 따라 자주 건너뛰었다).
5. 스토리(`st-*`)는 24시간 뒤 사라져 미디어 목록에 없다 → `not_found`. 보관함에 넣은 글도 `not_found`가 된다.
