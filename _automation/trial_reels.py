"""Meta Trial Reels: explicit mode approval, no public-post fallback."""
import hashlib,json

def approval_hash(item):
    return hashlib.sha256(json.dumps({k:item.get(k) for k in ('id','caption','comment','video','publish_at','trial_strategy','auto')},sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def trial_problem(item):
    mode=item.get('trial_strategy')
    if not mode:return ''
    if mode not in ('MANUAL','SS_PERFORMANCE'):return '지원하지 않는 파일럿 공개 방식'
    if not item.get('video') or item.get('auto') is not True:return '파일럿은 자동 게시 릴스만 지원'
    proof=item.get('trial_approval') or {}
    if not item.get('approved_by') or proof.get('mode')!=mode or not proof.get('at') or proof.get('hash')!=approval_hash(item):return '파일럿 방식·원고·일정의 최종 검수 승인 필요'
    return ''

def trial_params(item):return {'graduation_strategy':item['trial_strategy']}

def collect_metrics(items,token,http,graph,now):
    from datetime import datetime
    rows=[]
    for item in items:
        if not item.get('trial_strategy') or not item.get('post_id') or not item.get('published_at'):continue
        age=(now-datetime.fromisoformat(item['published_at'])).total_seconds()/3600
        window=72 if age>=72 else 24 if age>=24 else None
        if window is None:continue
        row={'queue_id':item['id'],'post_id':item['post_id'],'window_hours':window,'age_hours':round(age,2),'strategy':item['trial_strategy'],'checked_at':now.isoformat(),'metrics':{},'errors':{}}
        for metric,field in {'views':'total_views_count','likes':'like_count','comments':'comments_count','shares':'shares_count','saved':'saved_count'}.items():
            try:
                d=http('GET',f"{graph}/{item['post_id']}",{'fields':field,'access_token':token})
                row['metrics'][metric]=d.get(field)
            except Exception as e:row['errors'][metric]=type(e).__name__
        row['next_action']='앱에서 전체 공개 여부 검수' if item['trial_strategy']=='MANUAL' else 'Instagram 자동 전체 공개 상태 확인 필요'
        rows.append(row)
    return rows
