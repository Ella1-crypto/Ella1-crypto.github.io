import unittest, tempfile, json
from pathlib import Path
from datetime import datetime
import pickharu_ig_publish as ig
class ApprovalGate(unittest.TestCase):
 def test_unapproved_and_stopped_never_call_api(self):
  for extra in [{}, {'approved_by':'  '}, {'approved_by':'희야','stop_requested_at':'2026-11-25'}]:
   with self.subTest(extra=extra), tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp)/'queue.json'; p.write_text(json.dumps([{'id':'test','status':'예약','publish_at':'2026-11-25T12:00+09:00','auto':True,'video':'x.mp4',**extra}]))
    calls=[]
    result=ig.run_once(datetime(2026,11,25,12,0,tzinfo=ig.KST),'unused',http=lambda *a:calls.append(a),commit=lambda m:True,path=p)
    self.assertEqual(calls,[]);self.assertEqual(json.loads(p.read_text())[0]['status'],'보류');self.assertIn('올리지 않음',result)
if __name__=='__main__':unittest.main()
