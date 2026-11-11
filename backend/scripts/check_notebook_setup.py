"""Print connection results, never credentials or provider error bodies."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
import psycopg
from app.config import Settings

s = Settings()
print({key: bool(getattr(s, key)) for key in ('database_url', 'supabase_secret_key', 'gemini_api_key')})
try:
    with psycopg.connect(s.database_url.get_secret_value(), connect_timeout=10) as conn:
        print('database_connected:', conn.execute('select 1').fetchone()[0] == 1)
except Exception as error:
    message = str(error).lower()
    category = next((x for x in ('password authentication failed', 'could not translate host', 'timeout', 'network is unreachable', 'tenant or user not found') if x in message), type(error).__name__)
    print('database_connection_failed:', category)
try:
    key = s.supabase_secret_key.get_secret_value()
    if key.startswith('sb_publishable_'):
        raise ValueError('A server secret key is required')
    headers = {'apikey': key}
    if not key.startswith('sb_secret_'):
        headers['Authorization'] = 'Bearer ' + key
    response = httpx.get(str(s.supabase_url).rstrip('/') + '/storage/v1/bucket', headers=headers, timeout=10)
    print('storage_status:', response.status_code)
except Exception as error:
    print('storage_connection_failed:', type(error).__name__)
