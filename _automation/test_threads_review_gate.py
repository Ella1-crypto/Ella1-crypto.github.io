import sys,unittest,tempfile,copy,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
sys.path.append('/Users/jebbi/sns/Ella1-crypto.github.io/_automation')
import threads_review_gate as g
import pickharu_enqueue as en
import pickharu_publish as pub
from datetime import datetime
class Gate(unittest.TestCase):
 def setUp(self):
  self.item={'id':'test','kind':'일반','text':'테스트 초안','publish_at':'2026-11-26T15:00+09:00'}
  self.proof={'via':'telegram','decision':'final_approve','draft_id':'test','at':'2026-11-26T14:30+09:00','user_id':1,'message_id':2,'update_id':3}
 def test_no_approval(self):
  self.assertTrue(g.approval_problem(self.item))
  self.item['approved_by']='올려줘';self.assertTrue(g.approval_problem(self.item))
 def test_valid_then_modified(self):
  g.stamp_approval(self.item,self.proof);self.assertEqual(g.approval_problem(self.item),'')
  for k in ('text','reply','publish_at'):
   x=copy.deepcopy(self.item);x[k]='changed';self.assertTrue(g.approval_problem(x))
 def test_wrong_draft_or_revoked(self):
  g.stamp_approval(self.item,{**self.proof,'draft_id':'other'});self.assertTrue(g.approval_problem(self.item))
  g.stamp_approval(self.item,self.proof);self.item['approval_revoked_at']='now';self.assertTrue(g.approval_problem(self.item))
 def test_media_changed(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'image.png';p.write_bytes(b'old');self.item['images']=['image.png'];g.stamp_approval(self.item,self.proof,t)
   self.assertFalse(g.approval_problem(self.item,t));p.write_bytes(b'new');self.assertTrue(g.approval_problem(self.item,t))
 def test_chat_unbound(self):
  g.stamp_approval(self.item,{'via':'chat','decision':'final_approve','draft_id':'test','at':'now','source_message_id':'x','approval_quote':'확정'})
  self.assertTrue(g.approval_problem(self.item))
 def test_publisher_never_calls_api_without_review(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'q.json';p.write_text(json.dumps([{**self.item,'status':'예약'}]))
   def bad(*a,**k):self.fail('API must not be called')
   result=pub.run_once(datetime.fromisoformat(self.item['publish_at']),'unused',http=bad,commit=lambda m:True,path=p)
   self.assertIn('최종승인',result)
if __name__=='__main__':unittest.main()
