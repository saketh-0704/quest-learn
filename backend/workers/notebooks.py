"""Run separately: python workers/notebooks.py. One DB-coordinated processing slot."""
import json
import os
import subprocess
import sys
import time
from threading import Timer
from pathlib import Path
from tempfile import TemporaryFile
from uuid import UUID, uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings
from app.notebooks.store import database
from app.notebooks.processing import process, Cancelled
from app.notebooks.gemini import ModelError
from app.documents.processing import DocumentError


def claim(conn, timeout):
    conn.execute("update public.documents set status='failed',phase='failed',error_code='recovery_limit',failure_reason='Processing stopped repeatedly. Retry this source.' "
                 "where notebook_id is not null and status='processing' and lease_until<now() and attempts>=3")
    row = conn.execute("select d.id from public.documents d join public.notebooks n on n.id=d.notebook_id where not n.deleting and d.attempts<3 "
                       "and ((d.status='uploaded' and d.available_at<=now()) or (d.status='processing' and d.lease_until<now())) "
                       "order by d.available_at for update of d skip locked limit 1").fetchone()
    if not row:
        conn.commit()
        return None
    job = conn.execute("update public.documents set status='processing',phase='starting',attempts=attempts+1,job_token=%s,lease_until=now()+%s*interval '1 second' where id=%s returning id,job_token,attempts", (uuid4(), timeout+30, row['id'])).fetchone()
    conn.commit()
    return job


def fail(conn, job, code, message, retryable):
    retry = retryable and job['attempts'] < 3
    conn.execute("update public.documents set status=%s,phase=%s,error_code=%s,failure_reason=%s,available_at=now()+%s*interval '1 second',job_token=null,lease_until=null "
                 "where id=%s and job_token=%s and status='processing'",
                 ('uploaded' if retry else 'failed', 'retry_wait' if retry else 'failed', code, message,
                  30 * 2**(job['attempts']-1), job['id'], job['job_token']))
    conn.commit()


def run_once(settings):
    with database(settings) as conn:
        # A session advisory lock bounds aggregate concurrency, including multiple worker instances.
        if not conn.execute('select pg_try_advisory_lock(47009121) as acquired').fetchone()['acquired']:
            return False
        # An orphaned child retains this second slot until it exits or its watchdog fires.
        if not conn.execute('select pg_try_advisory_lock(47009122) as acquired').fetchone()['acquired']:
            return False
        conn.execute('select pg_advisory_unlock(47009122)')
        job = claim(conn, settings.notebook_job_timeout_seconds)
        if not job:
            return False
        child = None
        try:
            with TemporaryFile() as output:
                child = subprocess.Popen([sys.executable, __file__, '--job', str(job['id']), str(job['job_token'])], stdout=output, stderr=subprocess.DEVNULL)
                deadline = time.monotonic() + settings.notebook_job_timeout_seconds
                while child.poll() is None:
                    conn.commit()
                    live = conn.execute("select 1 from public.documents where id=%s and job_token=%s and status='processing'", (job['id'], job['job_token'])).fetchone()
                    if not live:
                        child.kill()
                        child.wait()
                        return True
                    if time.monotonic() >= deadline:
                        child.kill()
                        child.wait()
                        fail(conn, job, 'timeout', 'Document processing exceeded its time limit. Retry to resume saved work.', True)
                        return True
                    time.sleep(1)
                output.seek(0)
                try:
                    result = json.loads(output.read(8192))
                except (ValueError, UnicodeError):
                    result = {'code': 'worker_failed', 'message': 'Processing stopped unexpectedly. Saved work will be resumed.', 'retryable': True}
                if result.get('code'):
                    fail(conn, job, result['code'], result['message'], result.get('retryable', False))
        finally:
            if child and child.poll() is None:
                child.kill()
                child.wait()
    return True


def child_main(settings, document_id, token):
    watchdog = Timer(settings.notebook_job_timeout_seconds + 5, lambda: os._exit(124))
    watchdog.daemon = True
    watchdog.start()
    try:
        with database(settings) as slot:
            slot.execute('select pg_advisory_lock(47009122)')
            slot.commit()
            process(settings, UUID(document_id), UUID(token))
        return {'ok': True}
    except Cancelled:
        return {'cancelled': True}
    except (ModelError, DocumentError) as error:
        return {'code': error.code, 'message': str(error), 'retryable': getattr(error, 'retryable', False)}
    except Exception:
        return {'code': 'processing_failed', 'message': 'Processing failed. Check database, storage, and worker configuration; retry to resume.', 'retryable': True}
    finally:
        watchdog.cancel()


if __name__ == '__main__':
    settings = Settings()
    if len(sys.argv) == 4 and sys.argv[1] == '--job':
        print(json.dumps(child_main(settings, sys.argv[2], sys.argv[3])))
    else:
        print('Quest Learn worker started (one database-coordinated slot).', flush=True)
        while True:
            try:
                if not run_once(settings):
                    time.sleep(2)
            except KeyboardInterrupt:
                break
            except Exception:
                print('Worker could not reach its services; retrying in 10 seconds.', flush=True)
                time.sleep(10)
