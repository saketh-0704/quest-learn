"""Run against local API, frontend and worker. One disposable account; four Gemini calls."""
import os
import secrets
import subprocess
import sys
from pathlib import Path
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from app.config import Settings
from app.notebooks.store import database, storage

settings=Settings()
key=settings.supabase_secret_key.get_secret_value()
assert not key.startswith('sb_publishable_')
headers={'apikey':key}
if not key.startswith('sb_secret_'): headers['Authorization']='Bearer '+key
base=str(settings.supabase_url).rstrip('/')
email=f'notebook-browser-{uuid4().hex}@example.invalid'
password=secrets.token_urlsafe(32)
response=httpx.post(base+'/auth/v1/admin/users',headers=headers,json={'email':email,'password':password,'email_confirm':True},timeout=20)
assert response.status_code in (200,201), f'Test account setup failed: {response.status_code}'
user_id=response.json()['id']
try:
    environment={**os.environ,'NOTEBOOK_TEST_EMAIL':email,'NOTEBOOK_TEST_PASSWORD':password}
    root=Path(__file__).resolve().parents[2]
    result=subprocess.run(['node',str(root/'frontend/e2e/live-notebook.mjs')],env=environment,cwd=root,timeout=360)
    if result.returncode: raise RuntimeError('Live browser smoke failed')
finally:
    with database(settings) as conn:
        conn.execute("update public.notebooks set deleting=true where user_id=%s",(user_id,))
        conn.execute("update public.documents set status='cancelled',job_token=null where user_id=%s",(user_id,))
        paths=[row['storage_path'] for row in conn.execute('select storage_path from public.documents where user_id=%s',(user_id,)).fetchall()]
    if paths: storage(settings,'DELETE',json={'prefixes':paths})
    cleanup=httpx.delete(base+'/auth/v1/admin/users/'+user_id,headers=headers,timeout=20)
    assert cleanup.status_code in (200,204), 'Test account cleanup failed'
