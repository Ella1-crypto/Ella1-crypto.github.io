import sys,unittest,json,copy
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).parent));sys.path.append('/Users/jebbi/sns/Ella1-crypto.github.io/_automation')
import trial_reels as t
import pickharu_ig_publish as p
class Tests(unittest.TestCase):
 def item(self,mode='MANUAL'):
  q={'id':'x','caption':'검수 원고','video':'assets/test.mp4','publish_at':'2026-11-26T20:00+09:00','auto':True,'trial_strategy':mode,'approved_by':'검수 확정'}
  q['trial_approval']={'mode':mode,'at':'now','hash':t.approval_hash(q)};return q
 def test_requires_mode_approval(self):
  q=self.item();self.assertFalse(t.trial_problem(q));q['trial_strategy']='SS_PERFORMANCE';self.assertTrue(t.trial_problem(q))
 def test_modified_copy_blocks(self):
  q=self.item();q['caption']='다른 원고';self.assertTrue(t.trial_problem(q))
 def test_api_mode_no_fallback(self):
  for mode in ['MANUAL','SS_PERFORMANCE']:
   calls=[]
   def api(method,url,params):
    calls.append(params)
    return {'status_code':'FINISHED'} if method=='GET' else {'id':'123'}
   self.assertEqual(p.publish(self.item(mode),'user','secret',api,lambda s:None),'123');self.assertEqual(json.loads(calls[0]['trial_params'])['graduation_strategy'],mode)
  count=[]
  def failed(*a):count.append(1);raise ValueError('ineligible')
  with self.assertRaises(ValueError):p.publish(self.item(),'u','t',failed,lambda s:None)
  self.assertEqual(len(count),1)
 def test_metrics_not_zero_when_missing(self):
  q=self.item();q.update(post_id='123',published_at='2026-11-24T10:00:00+09:00')
  rows=t.collect_metrics([q],'t',lambda *a:{},'https://example',datetime(2026,11,26,6,tzinfo=timezone.utc));self.assertEqual(rows[0]['window_hours'],24);self.assertIsNone(rows[0]['metrics']['views'])
if __name__=='__main__':unittest.main()
