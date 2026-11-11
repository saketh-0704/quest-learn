from uuid import UUID, uuid4
from functools import partial
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator
from psycopg.types.json import Jsonb
from app.auth.dependencies import VerifiedUser
from app.documents.processing import validate_file, ProcessingLimits, DocumentError
from app.notebooks.store import database, owned_notebook, owned_document, storage
from app.notebooks.gemini import embed, grounded_answer, generate_practice, ModelError
from app.retrieval.service import retrieve_document, RetrievalError
from app.retrieval.models import QueryEmbedding

router = APIRouter(prefix='/notebooks', tags=['notebooks'])


class Title(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=120)

    @field_validator('title')
    @classmethod
    def clean(cls, value):
        if not value.strip() or '\x00' in value:
            raise ValueError('A title is required')
        return value.strip()


class Question(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    question: str = Field(min_length=1, max_length=2000)
    document_ids: list[UUID] = Field(min_length=1, max_length=4)

    @field_validator('question')
    @classmethod
    def clean(cls, value):
        if not value.strip() or '\x00' in value:
            raise ValueError('A question is required')
        return value.strip()


class Progress(BaseModel):
    model_config = ConfigDict(extra='forbid')
    learned: bool


@router.get('')
def list_notebooks(request: Request, user: VerifiedUser):
    with database(request.app.state.settings) as conn:
        return conn.execute('select n.*, (select count(*) * 100 from public.documents d where '
                            'd.notebook_id=n.id and d.user_id=n.user_id and d.learned and d.status=\'ready\') as xp '
                            'from public.notebooks n where n.user_id=%s order by n.created_at desc', (user.id,)).fetchall()


@router.post('', status_code=201)
def create_notebook(payload: Title, request: Request, user: VerifiedUser):
    with database(request.app.state.settings) as conn:
        return conn.execute('insert into public.notebooks(user_id,title) values (%s,%s) returning *',
                            (user.id, payload.title)).fetchone()


@router.patch('/{notebook_id}')
def rename_notebook(notebook_id: UUID, payload: Title, request: Request, user: VerifiedUser):
    with database(request.app.state.settings) as conn:
        owned_notebook(conn, notebook_id, user.id, lock=True)
        return conn.execute('update public.notebooks set title=%s where id=%s and user_id=%s returning *',
                            (payload.title, notebook_id, user.id)).fetchone()


@router.get('/{notebook_id}')
def get_notebook(notebook_id: UUID, request: Request, user: VerifiedUser):
    # shortcut: full history is appropriate for small notebooks; paginate before large-scale rollout.
    with database(request.app.state.settings) as conn:
        notebook = owned_notebook(conn, notebook_id, user.id)
        documents = conn.execute('select * from public.documents where notebook_id=%s and user_id=%s order by created_at',
                                 (notebook_id, user.id)).fetchall()
        turns = conn.execute('select * from public.notebook_turns where notebook_id=%s and user_id=%s order by created_at,id',
                             (notebook_id, user.id)).fetchall()
        return {'notebook': notebook, 'documents': documents, 'turns': turns}


@router.delete('/{notebook_id}')
def delete_notebook(notebook_id: UUID, request: Request, user: VerifiedUser):
    settings = request.app.state.settings
    # Tombstone first: block new uploads/jobs, preserve metadata if Storage fails.
    with database(settings) as conn:
        row = conn.execute('update public.notebooks set deleting=true where id=%s and user_id=%s returning id',
                           (notebook_id, user.id)).fetchone()
        if not row:
            raise HTTPException(404, 'Notebook not found.')
        conn.execute("update public.documents set status='cancelled',job_token=null where notebook_id=%s and user_id=%s",
                     (notebook_id, user.id))
    with database(settings) as conn:
        paths = [row['storage_path'] for row in conn.execute('select storage_path from public.documents where notebook_id=%s and user_id=%s', (notebook_id, user.id)).fetchall()]
        for start in range(0, len(paths), 100):
            storage(settings, 'DELETE', json={'prefixes': paths[start:start+100]})
        conn.execute('delete from public.notebooks where id=%s and user_id=%s', (notebook_id, user.id))
    return {'deleted': True}


def save_upload(settings, notebook_id, user_id, filename, content_type, data):
    try:
        kind = validate_file(filename, data, content_type, ProcessingLimits())
    except DocumentError as error:
        raise HTTPException(413 if error.code == 'file_too_large' else 422,
                            {'code': error.code, 'message': str(error)}) from None
    with database(settings) as conn:
        owned_notebook(conn, notebook_id, user_id, lock=True)
        row = conn.execute("insert into public.documents(id,user_id,notebook_id,filename,kind,content_type,size_bytes,status,phase,error_code,failure_reason) "
                           "values (%s,%s,%s,%s,%s,%s,%s,'failed','uploading','upload_interrupted','Upload did not finish. Upload the file again.') returning *",
                           (uuid4(), user_id, notebook_id, filename, kind, content_type, len(data))).fetchone()
        # Keep the recovery record even if the object upload or queue update fails.
        conn.commit()
        owned_notebook(conn, notebook_id, user_id, lock=True)
        storage(settings, 'POST', '/' + row['storage_path'], content=data, headers={'Content-Type': content_type})
        return conn.execute("update public.documents set status='uploaded',phase='queued',error_code=null,failure_reason=null where id=%s and user_id=%s returning *",
                            (row['id'], user_id)).fetchone()


@router.post('/{notebook_id}/documents', status_code=202)
async def upload_document(notebook_id: UUID, filename: str, request: Request, user: VerifiedUser):
    settings = request.app.state.settings
    # Check ownership before reading the upload body.
    def check():
        with database(settings) as conn:
            owned_notebook(conn, notebook_id, user.id)
    await run_in_threadpool(check)
    data = bytearray()
    async for part in request.stream():
        if len(data) + len(part) > 10 * 1024 * 1024:
            raise HTTPException(413, {'code': 'file_too_large', 'message': 'Choose a PDF or TXT file up to 10 MB.'})
        data.extend(part)
    content_type = request.headers.get('content-type', '').split(';')[0]
    return await run_in_threadpool(partial(save_upload, settings, notebook_id, user.id, filename, content_type, bytes(data)))


@router.post('/sources/{document_id}/cancel')
def cancel_document(document_id: UUID, request: Request, user: VerifiedUser):
    with database(request.app.state.settings) as conn:
        owned_document(conn, document_id, user.id)
        conn.execute("update public.documents set status='cancelled',phase='cancelled',job_token=null where id=%s and user_id=%s and status in ('uploaded','processing')", (document_id, user.id))
    return {'cancelled': True}


@router.post('/sources/{document_id}/retry')
def retry_document(document_id: UUID, request: Request, user: VerifiedUser):
    with database(request.app.state.settings) as conn:
        row = owned_document(conn, document_id, user.id)
        materials = row['materials'] or []
        legacy_plan = row['status'] == 'ready' and (
            not any(m.get('topics') for m in materials) or materials[0].get('intro_version') != 2)
        if row['status'] not in ('failed', 'cancelled') and not legacy_plan:
            raise HTTPException(409, 'This source is already processing or has a topic plan.')
        storage(request.app.state.settings, 'GET', '/' + row['storage_path'])
        conn.execute("update public.documents set status='uploaded',phase='queued',attempts=0,available_at=now(),job_token=null,error_code=null,failure_reason=null where id=%s and user_id=%s and status=%s", (document_id, user.id, row['status']))
    return {'queued': True}


@router.patch('/sources/{document_id}/progress')
def save_progress(document_id: UUID, payload: Progress, request: Request, user: VerifiedUser):
    with database(request.app.state.settings) as conn:
        row = owned_document(conn, document_id, user.id)
        if row['status'] != 'ready':
            raise HTTPException(409, 'Wait for source processing to finish.')
        conn.execute('update public.documents set learned=%s where id=%s and user_id=%s', (payload.learned, document_id, user.id))
    return {'learned': payload.learned}


@router.post('/sources/{document_id}/practice')
def source_practice(document_id: UUID, request: Request, user: VerifiedUser):
    settings = request.app.state.settings
    with database(settings) as conn:
        row = owned_document(conn, document_id, user.id)
        if row['status'] != 'ready':
            raise HTTPException(409, 'Wait for source processing to finish.')
        if not conn.execute('select pg_try_advisory_lock(hashtextextended(%s,0)) as acquired',
                            (str(row['notebook_id']),)).fetchone()['acquired']:
            raise HTTPException(409, 'Another request is already running for this notebook.')
        conn.commit()
        try:
            return generate_practice(settings, row['materials'] or [])
        except ModelError as error:
            status = {'quota': 429, 'no_evidence': 422}.get(error.code, 502)
            raise HTTPException(status, {'code': error.code, 'message': str(error)}) from None


@router.get('/sources/{document_id}/file')
def source_file(document_id: UUID, request: Request, user: VerifiedUser):
    with database(request.app.state.settings) as conn:
        row = owned_document(conn, document_id, user.id)
    content = storage(request.app.state.settings, 'GET', '/' + row['storage_path']).content
    return Response(content, media_type=row['content_type'], headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('/{notebook_id}/questions')
def ask(notebook_id: UUID, payload: Question, request: Request, user: VerifiedUser):
    settings = request.app.state.settings
    with database(settings) as conn:
        owned_notebook(conn, notebook_id, user.id)
        # Session lock bounds concurrent model calls and serializes notebook history.
        if not conn.execute('select pg_try_advisory_lock(hashtextextended(%s,0)) as acquired', (str(notebook_id),)).fetchone()['acquired']:
            raise HTTPException(409, 'An answer is already being generated for this notebook.')
        existing = conn.execute('select * from public.notebook_turns where id=%s and notebook_id=%s and user_id=%s', (payload.id, notebook_id, user.id)).fetchone()
        if existing:
            if existing['question'] != payload.question:
                raise HTTPException(409, 'This request ID already belongs to a different question.')
            return existing
        documents = [owned_document(conn, item, user.id) for item in dict.fromkeys(payload.document_ids)]
        if any(row['notebook_id'] != notebook_id for row in documents):
            raise HTTPException(404, 'Source not found in this notebook.')
        if any(row['status'] != 'ready' for row in documents):
            raise HTTPException(409, 'Wait for all selected sources to finish processing.')
        history = conn.execute('select question,answer from public.notebook_turns where notebook_id=%s and user_id=%s order by created_at desc limit 6', (notebook_id, user.id)).fetchall()[::-1]
        conn.commit()
        try:
            vector = QueryEmbedding(model=settings.gemini_embedding_model, values=embed(settings, [payload.question], query=True)[0])
            evidence = []
            for document in documents:
                result = retrieve_document(user_id=user.id, document_id=document['id'], query_text=payload.question, query_embedding=vector, settings=settings)
                evidence.extend({'chunk_id': str(chunk.chunk_id), 'document_id': str(document['id']), 'filename': document['filename'],
                                 'page_number': chunk.page_number, 'content': chunk.content} for chunk in result.chunks)
            answer = grounded_answer(settings, payload.question, evidence, history)
        except ModelError as error:
            raise HTTPException(429 if error.code == 'quota' else 502, {'code': error.code, 'message': str(error)}) from None
        except RetrievalError as error:
            raise HTTPException(503, str(error)) from None
        owned_notebook(conn, notebook_id, user.id, lock=True)
        return conn.execute('insert into public.notebook_turns(id,notebook_id,user_id,question,answer,sources) values (%s,%s,%s,%s,%s,%s) returning *',
                            (payload.id, notebook_id, user.id, payload.question, answer['answer'], Jsonb(answer['sources']))).fetchone()
