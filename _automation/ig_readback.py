"""Read-only reconciliation for manual/failed queued videos. No tokens in output."""
import json
from datetime import datetime,timezone

def inspect(token, configured):
 from pickharu_ig_publish import find_ig_user,http_json,GRAPH,QUEUE_PATH,load_queue
 uid=find_ig_user(token,configured=configured)
 data=http_json('GET',f'{GRAPH}/{uid}/media',{'fields':'id,caption,media_type,timestamp,permalink','limit':'100','access_token':token})
 posts=data.get('data',[])
 rows=[]
 for item in load_queue(QUEUE_PATH):
  if item.get('status') not in ['직접 게시','실패'] or not item.get('video'):continue
  exact=[{k:x.get(k) for k in ['id','timestamp','media_type','permalink']} for x in posts if x.get('caption','').strip()==item.get('caption','').strip()]
  rows.append({'queue_id':item['id'],'exact_matches':exact,'auto':item.get('auto'),'status':item.get('status')})
 print('READBACK '+json.dumps({'checked_at':datetime.now(timezone.utc).isoformat(),'account_verified':True,'count':len(posts),'oldest':posts[-1].get('timestamp') if posts else None,'items':rows},ensure_ascii=False))
