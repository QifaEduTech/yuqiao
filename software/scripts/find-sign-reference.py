"""Read saved videos and re-run the local classifier to shortlist a reference.

Does not alter accounts, mark a motion verified, or copy private footage to public/.
Only matching candidates are printed; the result is not a historical prediction.
"""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import os, sys, sqlite3, json
from pathlib import Path
from datetime import datetime, timezone, timedelta
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
for name in ('TEMP', 'TMP', 'TMPDIR'):
    os.environ[name] = str(ROOT / '.runtime-logs/tmp')
os.environ['MPLCONFIGDIR'] = str(ROOT / '.runtime-logs/matplotlib')
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(ROOT / 'server'))
from sign_worker import recognize

db = _project_db_connect((ROOT / 'data/app.sqlite').as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
rows = db.execute("SELECT id, media_file, duration, created_at FROM records WHERE kind='video' ORDER BY created_at DESC").fetchall()
matches = []
errors = 0
for row in rows:
    path = (ROOT / 'data/media' / row['media_file']).resolve()
    if path.parent != (ROOT / 'data/media').resolve() or not path.is_file():
        errors += 1
        continue
    try:
        result = recognize(path)
        if result.get('status') == 'candidate' and result.get('candidate') == '谢谢':
            item = {'record_id':row['id'], 'saved_at':datetime.fromtimestamp(row['created_at']/1000,timezone(timedelta(hours=8))).isoformat(),
                    'candidate':'谢谢', 'score':result.get('score'), 'duration_seconds':result.get('duration_seconds'),
                    'hand_frames':result.get('hand_frames'), 'sampled_frames':result.get('sampled_frames'),
                    'evidence':'fresh_local_inference_not_historical_result', 'review':'not_reviewed'}
            matches.append(item)
            print(json.dumps(item, ensure_ascii=False), flush=True)
    except Exception as error:
        errors += 1
        print(json.dumps({'record_id':row['id'], 'error':str(error)}, ensure_ascii=False), flush=True)
print(json.dumps({'saved_videos':len(rows), 'matching_candidates':len(matches), 'errors':errors}, ensure_ascii=False), flush=True)
db.close()
