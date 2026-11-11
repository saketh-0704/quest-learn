"""Server-side database and private object access; owners come from verified Auth."""
from contextlib import contextmanager
import logging
import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.conninfo import conninfo_to_dict
from fastapi import HTTPException

logger = logging.getLogger(__name__)


@contextmanager
def database(settings):
    if not settings.database_url:
        raise HTTPException(503, 'Notebook persistence requires DATABASE_URL.')
    if conninfo_to_dict(settings.database_url.get_secret_value()).get('port') == '6543':
        raise HTTPException(503, 'Use the Supabase session pooler on port 5432; transaction pooling cannot hold worker locks.')
    try:
        with psycopg.connect(settings.database_url.get_secret_value(), connect_timeout=5,
                              row_factory=dict_row, options='-c statement_timeout=15000') as conn:
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise
            finally:
                conn.execute('select pg_advisory_unlock_all()')
    except psycopg.Error as error:
        logger.warning('Notebook database request failed (%s, SQLSTATE %s)',
                       type(error).__name__, error.sqlstate or 'unavailable')
        raise HTTPException(503, 'The notebook database is temporarily unavailable. Try again.') from None


def owned_notebook(conn, notebook_id, user_id, lock=False):
    row = conn.execute('select * from public.notebooks where id=%s and user_id=%s' +
                       (' for update' if lock else ''), (notebook_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Notebook not found.')
    if row['deleting']:
        raise HTTPException(409, 'Notebook deletion is in progress. Retry deletion to finish.')
    return row


def owned_document(conn, document_id, user_id):
    row = conn.execute('select d.* from public.documents d join public.notebooks n on n.id=d.notebook_id '
                       'where d.id=%s and d.user_id=%s and not n.deleting', (document_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Source not found.')
    return row


def storage(settings, method, path='', **kwargs):
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise HTTPException(503, 'Private files require SUPABASE_SECRET_KEY and SUPABASE_URL.')
    key = settings.supabase_secret_key.get_secret_value()
    if key.startswith('sb_publishable_'):
        raise HTTPException(503, 'SUPABASE_SECRET_KEY must be a server secret key, not a publishable key.')
    headers = {'apikey': key}
    if not key.startswith('sb_secret_'):
        headers['Authorization'] = f'Bearer {key}'
    headers.update(kwargs.pop('headers', {}))
    try:
        response = httpx.request(method, f'{str(settings.supabase_url).rstrip("/")}/storage/v1/object/'
                                f'{settings.storage_bucket}{path}', headers=headers, timeout=60, **kwargs)
        response.raise_for_status()
        return response
    except httpx.HTTPStatusError as error:
        logger.warning('Private file storage %s returned HTTP %s', method, error.response.status_code)
        raise HTTPException(503, 'Private file storage is unavailable. Please retry.') from None
    except httpx.RequestError as error:
        logger.warning('Private file storage %s failed (%s)', method, type(error).__name__)
        raise HTTPException(503, 'Private file storage is unavailable. Please retry.') from None
