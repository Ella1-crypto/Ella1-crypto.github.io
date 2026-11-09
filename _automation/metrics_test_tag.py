"""7일 테스트 보드 — 큐 항목에 test 메타데이터를 붙인다(무엇을 실험하는 글인지).

큐 항목의 test 모양:
  "test": {"group": "yt-repost-hook", "variable": "hook_type", "variant": "②숫자", "variant_label": "②",
           "hypothesis": "숫자 훅이 정리 훅보다 저장률이 높다", "kpi": "saves_shares_per_reach", "tagged_at": "2026-11-09"}
  variable: hook_type | format | length | color | time        kpi: saves_shares_per_reach(인스타 기본) | engage_per_view(스레드 기본)
  hook_type 변형은 ①장면 ②숫자 ③반전 ④질문 ⑤고백 ⑥정리 (studio script.json hooks[].type의 동그라미 숫자로 맞춘다)

사용(큐는 ig | heeya | pickharu 또는 파일 경로):
  python3 metrics_test_tag.py tag ig ig-aitip-01-chatgpt-work --variable hook_type --variant ④ --hypothesis "..." [--group G] [--kpi K] [--commit]
  python3 metrics_test_tag.py auto ig ig-aitip-01-chatgpt-work --script ~/sns/studio/jobs/20261109-aitip-01-chatgpt-work/script.json \\
          --hypothesis "..." [--group G] [--commit]        # 고른 훅(cover.title과 같은 hooks[].text, 없으면 chosen)의 type으로 hook_type 태그
  python3 metrics_test_tag.py batch metrics/tests/backfill-20261109.json [--commit]   # [{"queue": "ig", "id": ..., "test": {...}}, ...]
  python3 metrics_test_tag.py show ig                                               # 태그 달린 항목 보기
  python3 metrics_test_tag.py untag ig <id> [--commit]
큐의 다른 칸(status·publish_at·caption 등)은 건드리지 않는다. --commit은 큐 파일만 커밋·푸시한다
(인스타 큐 푸시는 ig-pickharu 워크플로를 깨우지만, 예약 글이 없으면 바로 끝난다).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
HERE = Path(__file__).resolve().parent
SITE_ROOT = HERE.parent
QUEUES = {"ig": HERE / "pickharu-ig-queue.json", "heeya": HERE / "jaetech-queue.json", "pickharu": HERE / "pickharu-queue.json"}
VARIABLES = ("hook_type", "format", "length", "color", "time")
HOOK_TYPES = {"①": "①장면", "②": "②숫자", "③": "③반전", "④": "④질문", "⑤": "⑤고백", "⑥": "⑥정리"}
DEFAULT_KPI = {"ig": "saves_shares_per_reach", "heeya": "engage_per_view", "pickharu": "engage_per_view"}


def queue_path(name: str) -> Path:
    if name in QUEUES:
        return QUEUES[name]
    path = Path(name).expanduser()
    if not path.exists():
        raise SystemExit(f"큐를 찾을 수 없음: {name}")
    return path


def queue_alias(path: Path) -> str:
    for alias, p in QUEUES.items():
        if p.resolve() == path.resolve():
            return alias
    return "ig" if "ig-queue" in path.name else "pickharu"


def load(path: Path) -> list[dict]:
    items = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(items, list):
        raise SystemExit("큐 형식이 목록이 아님")
    return items


def save(items: list[dict], path: Path) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)


def normalize_hook(label: str) -> tuple[str, str]:
    """'④구체 질문' → ('④질문', '④구체 질문'). 동그라미 숫자가 없으면 그대로."""
    label = (label or "").strip()
    for digit, canon in HOOK_TYPES.items():
        if label.startswith(digit):
            return canon, label
    return label, label


def make_test(variable: str, variant: str, hypothesis: str, kpi: str, group: str | None, variant_label: str | None = None) -> dict:
    if variable not in VARIABLES:
        raise SystemExit(f"variable은 {', '.join(VARIABLES)} 중 하나")
    if variable == "hook_type":
        variant, variant_label = normalize_hook(variant) if not variant_label else (normalize_hook(variant)[0], variant_label)
    test = {"group": group or f"{variable}-{datetime.now(KST):%Y%m%d}", "variable": variable, "variant": variant,
            "hypothesis": hypothesis.strip(), "kpi": kpi, "tagged_at": datetime.now(KST).strftime("%Y-%m-%d")}
    if variant_label and variant_label != variant:
        test["variant_label"] = variant_label
    return test


def chosen_hook(script: dict) -> dict | None:
    hooks = script.get("hooks") or []
    if not hooks:
        return None
    title = re.sub(r"\s+", "", ((script.get("cover") or {}).get("title") or ""))
    for hook in hooks:
        text = re.sub(r"\s+", "", hook.get("text") or "")
        if text and title and (text in title or title in text or text.rstrip("?!") == title.rstrip("?!")):
            return hook
    chosen = script.get("chosen")
    if isinstance(chosen, int):
        if 1 <= chosen <= len(hooks):
            return hooks[chosen - 1]
        if 0 <= chosen < len(hooks):
            return hooks[chosen]
    return hooks[0]


def apply(items: list[dict], item_id: str, test: dict | None) -> list[dict]:
    found = False
    out = []
    for item in items:
        if item.get("id") == item_id:
            found = True
            item = {k: v for k, v in item.items() if k != "test"}
            if test is not None:
                item["test"] = test
        out.append(item)
    if not found:
        raise SystemExit(f"큐에 없는 id: {item_id}")
    return out


def git_commit_push(paths: list[Path], message: str) -> str:
    run = lambda *args: subprocess.run(["git", *args], cwd=SITE_ROOT, capture_output=True, text=True)
    run("add", "--", *[str(p) for p in paths])
    if run("diff", "--cached", "--quiet").returncode == 0:
        return "바뀐 내용 없음"
    if run("commit", "-m", message).returncode != 0:
        return "커밋 실패"
    if run("push").returncode == 0:
        return "푸시함"
    if run("pull", "--rebase").returncode == 0 and run("push").returncode == 0:
        return "푸시함(rebase)"
    return "푸시 실패(커밋은 로컬에 남음)"


def describe(item: dict) -> str:
    t = item.get("test", {})
    return f"{item.get('id')} [{item.get('status')}] {item.get('publish_at', '')[:16]} | {t.get('group')} | {t.get('variable')}={t.get('variant')}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    tag = sub.add_parser("tag", help="항목 하나에 태그")
    tag.add_argument("queue"); tag.add_argument("id")
    tag.add_argument("--variable", required=True, choices=VARIABLES)
    tag.add_argument("--variant", required=True)
    tag.add_argument("--hypothesis", required=True)
    tag.add_argument("--kpi"); tag.add_argument("--group"); tag.add_argument("--commit", action="store_true")

    auto = sub.add_parser("auto", help="studio script.json의 고른 훅으로 hook_type 태그")
    auto.add_argument("queue"); auto.add_argument("id")
    auto.add_argument("--script", required=True)
    auto.add_argument("--hypothesis", default="고른 훅 유형이 도달 대비 저장+공유를 높인다")
    auto.add_argument("--kpi"); auto.add_argument("--group"); auto.add_argument("--commit", action="store_true")

    batch = sub.add_parser("batch", help="JSON 목록으로 여러 항목에 태그")
    batch.add_argument("spec"); batch.add_argument("--commit", action="store_true")

    show = sub.add_parser("show", help="태그 달린 항목 보기")
    show.add_argument("queue")

    untag = sub.add_parser("untag", help="태그 지우기")
    untag.add_argument("queue"); untag.add_argument("id"); untag.add_argument("--commit", action="store_true")

    args = parser.parse_args(argv)
    touched: list[Path] = []
    message = ""

    if args.cmd == "show":
        path = queue_path(args.queue)
        for item in load(path):
            if item.get("test"):
                print(describe(item))
        return 0

    if args.cmd in ("tag", "auto", "untag"):
        path = queue_path(args.queue)
        alias = queue_alias(path)
        items = load(path)
        if args.cmd == "untag":
            items = apply(items, args.id, None)
            message = f"test: {args.id} 태그 지움"
        else:
            kpi = args.kpi or DEFAULT_KPI[alias]
            if args.cmd == "tag":
                test = make_test(args.variable, args.variant, args.hypothesis, kpi, args.group)
            else:
                script = json.loads(Path(args.script).expanduser().read_text(encoding="utf-8"))
                hook = chosen_hook(script)
                if not hook:
                    raise SystemExit("script.json에 hooks가 없음 — tag 명령으로 직접 적어 주세요")
                canon, raw = normalize_hook(hook.get("type", ""))
                test = make_test("hook_type", canon, args.hypothesis, kpi, args.group, variant_label=raw)
                test["hook_text"] = (hook.get("text") or "").strip()
            items = apply(items, args.id, test)
            message = f"test: {args.id} {test['variable']}={test['variant']} ({test['group']})"
        save(items, path)
        touched.append(path)
        print(message)

    if args.cmd == "batch":
        spec = json.loads(Path(args.spec).expanduser().read_text(encoding="utf-8"))
        entries = spec["items"] if isinstance(spec, dict) else spec
        by_queue: dict[Path, list[dict]] = {}
        count = 0
        for entry in entries:
            path = queue_path(entry["queue"])
            alias = queue_alias(path)
            items = by_queue.setdefault(path, load(path))
            t = entry["test"]
            test = make_test(t["variable"], t["variant"], t["hypothesis"], t.get("kpi") or DEFAULT_KPI[alias], t.get("group"),
                             variant_label=t.get("variant_label"))
            if t.get("hook_text"):
                test["hook_text"] = t["hook_text"]
            by_queue[path] = apply(items, entry["id"], test)
            count += 1
        for path, items in by_queue.items():
            save(items, path)
            touched.append(path)
        message = f"test: 7일 테스트 태그 {count}개 ({Path(args.spec).stem})"
        print(message)

    if getattr(args, "commit", False) and touched:
        print(git_commit_push(touched, message))
    return 0


if __name__ == "__main__":
    sys.exit(main())
