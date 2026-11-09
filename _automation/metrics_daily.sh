#!/bin/sh
# 매일 23:30 launchd(com.sns.metrics-daily)가 부른다: 저장소 최신화 → 인스타·heeya 스레드 성과 수집 → 커밋·푸시.
# 토큰은 ~/sns/content-automation/.env 에서 수집기가 직접 읽는다(여기서 출력하지 않음). 실패하면 텔레그램 outbox에 한 줄 남긴다.
set -u
REPO="$HOME/sns/Ella1-crypto.github.io"
ENV_FILE="$HOME/sns/content-automation/.env"
OUTBOX="$HOME/sns/pickharu/data/telegram/outbox"
LOG="$REPO/_automation/metrics/collect.log"
ACCOUNTS="${METRICS_ACCOUNTS:-ig-pickharu,threads-heeya}"
PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export PATH

mkdir -p "$(dirname "$LOG")"
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') 수집 시작 ($ACCOUNTS)"
  git -C "$REPO" pull --ff-only 2>&1 | tail -1
  cd "$REPO/_automation" || exit 1
  OUT=$(python3 metrics_collect.py --env-file "$ENV_FILE" --accounts "$ACCOUNTS" --commit 2>&1)
  STATUS=$?
  echo "$OUT"
  if [ "$STATUS" -ne 0 ] || echo "$OUT" | grep -q "푸시 실패\|연결 실패\|계정 조회 실패"; then
    sleep 60
    OUT=$(python3 metrics_collect.py --env-file "$ENV_FILE" --accounts "$ACCOUNTS" --commit 2>&1)
    STATUS=$?
    echo "--- 재시도"; echo "$OUT"
    if [ "$STATUS" -ne 0 ] || echo "$OUT" | grep -q "푸시 실패\|연결 실패\|계정 조회 실패"; then
      mkdir -p "$OUTBOX"
      LINE=$(echo "$OUT" | grep "실패" | head -1 | cut -c1-200)
      echo "📉 성과 수집 실패 $(date '+%m/%d'): ${LINE:-알 수 없는 오류} (자세한 건 _automation/metrics/collect.log)" > "$OUTBOX/$(date '+%Y-%m-%d')-metrics-fail.txt"
    fi
  fi
  echo "=== 끝"
} >> "$LOG" 2>&1
# 로그가 너무 커지면 뒤 400줄만 남긴다
if [ "$(wc -l < "$LOG")" -gt 2000 ]; then tail -400 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
