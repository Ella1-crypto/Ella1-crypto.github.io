"""Concrete draft approval, bound to published copy and media bytes."""
import hashlib
import json
from pathlib import Path
FIELDS = ('id','kind','text','reply','thread','video','images','gif','quote_of','reply_to_post','publish_at','expires_at')
ROOT = Path(__file__).resolve().parent.parent

def content_hash(item, root=None):
    root = Path(root) if root else ROOT
    h = hashlib.sha256(json.dumps({k:item.get(k) for k in FIELDS},ensure_ascii=False,sort_keys=True).encode())
    for name in ([item['video']] if item.get('video') else []) + (item.get('images') or []):
        p = (root / name).resolve()
        if not p.is_relative_to(root.resolve()) or not p.is_file():
            raise ValueError('승인 대상 미디어 파일 확인 불가')
        h.update(name.encode());h.update(hashlib.sha256(p.read_bytes()).digest())
    return h.hexdigest()

def valid_evidence(a, item):
    if not isinstance(a,dict) or a.get('decision') != 'final_approve' or a.get('draft_id') != item.get('id') or not a.get('at'):
        return False
    if a.get('via') == 'telegram':
        return all(isinstance(a.get(k),int) and a[k]>0 for k in ('user_id','message_id','update_id'))
    return a.get('via') == 'chat' and bool(a.get('source_message_id')) and bool(a.get('approval_quote')) and a.get('reviewed_content_hash') == item.get('approved_content_hash')

def stamp_approval(item, evidence, root=None):
    if not isinstance(evidence,dict):
        raise ValueError('구체적인 초안의 최종 검수 승인 필요 — 먼저 검수 요청을 보내 주세요')
    item['review_approval']=dict(evidence)
    item['approved_content_hash']=content_hash(item,root)

def approval_problem(item, root=None):
    if item.get('stop_requested_at') or item.get('approval_revoked_at'):
        return '사용자가 진행을 중단하거나 승인을 취소함'
    if not valid_evidence(item.get('review_approval'), item):
        return '구체적인 초안 최종승인 증거 없음 — 검수 전 게시 차단'
    try:
        if item.get('approved_content_hash') != content_hash(item,root):
            return '검수 뒤 내용·미디어·일정 변경 — 다시 검수 필요'
    except ValueError as e:
        return str(e)
    return ''
