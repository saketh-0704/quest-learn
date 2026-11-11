"""Opt in with NOTEBOOK_INTEGRATION=1. Uses disposable users and their own records only."""
import os
import secrets
from uuid import uuid4
from pathlib import Path
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app.notebooks.store import database, storage
from app.notebooks.processing import process, Cancelled
from app.notebooks.gemini import ModelError
from workers.notebooks import claim, fail, run_once

pytestmark = pytest.mark.skipif(os.getenv('NOTEBOOK_INTEGRATION') != '1', reason='Requires explicitly enabled real Supabase fixture')


class TestAccounts(list):
    __test__ = False
    def __repr__(self):
        return '<disposable test accounts; credentials redacted>'


@pytest.fixture(scope='module')
def accounts():
    settings=Settings()
    key=settings.supabase_secret_key.get_secret_value()
    assert not key.startswith('sb_publishable_'), 'Set a server secret key, not the publishable key'
    headers={'apikey':key}
    if not key.startswith('sb_secret_'): headers['Authorization']='Bearer '+key
    base=str(settings.supabase_url).rstrip('/')
    created=TestAccounts()
    try:
        for _ in range(2):
            email=f'notebook-test-{uuid4().hex}@example.invalid'
            password=secrets.token_urlsafe(32)
            response=httpx.post(base+'/auth/v1/admin/users',headers=headers,json={'email':email,'password':password,'email_confirm':True},timeout=30)
            assert response.status_code in (200,201), f'Could not create test identity: {response.status_code}'
            user=response.json(); created.append({'id':user['id']})
            login=httpx.post(base+'/auth/v1/token?grant_type=password',headers={'apikey':settings.supabase_publishable_key.get_secret_value()},json={'email':email,'password':password},timeout=30)
            assert login.status_code == 200
            created[-1]['headers']={'Authorization':'Bearer '+login.json()['access_token']}
        yield settings,created
    finally:
        for user in created:
            with database(settings) as conn:
                paths=[r['storage_path'] for r in conn.execute('select storage_path from public.documents where user_id=%s',(user['id'],)).fetchall()]
            if paths: storage(settings,'DELETE',json={'prefixes':paths})
            response=httpx.delete(base+'/auth/v1/admin/users/'+user['id'],headers=headers,timeout=30)
            assert response.status_code in (200,204), 'Test-user cleanup failed'


@pytest.fixture
def context(accounts):
    settings,users=accounts
    with TestClient(create_app(settings)) as client:
        response=client.post('/api/notebooks',json={'title':'Integration fixture'},headers=users[0]['headers'])
        assert response.status_code == 201, response.text
        notebook=response.json()['id']
        yield settings, users, client, notebook
        response=client.delete('/api/notebooks/'+notebook,headers=users[0]['headers'])
        assert response.status_code in (200,404), response.text


def upload(context,filename='cedar.txt',data=b'The Cedar library lends three books for fourteen days. Members renew once at the desk.'):
    _,users,client,notebook=context
    response=client.post(f'/api/notebooks/{notebook}/documents?filename={filename}',headers={**users[0]['headers'],'Content-Type':'application/pdf' if filename.endswith('.pdf') else 'text/plain'},content=data)
    assert response.status_code==202,response.text
    return response.json()


def claim_one(settings, document):
    # Isolate tests from any real queued work: claim only our fixture directly.
    with database(settings) as conn:
        return conn.execute("update public.documents set status='processing',job_token=%s,attempts=attempts+1,lease_until=now()+interval '15 minutes' where id=%s returning *",(uuid4(),document['id'])).fetchone()


def fake_models(monkeypatch):
    from app.notebooks import processing
    calls=[]
    def embeddings(settings,texts):
        calls.append(len(texts)); return [[1.0]+[0.0]*767 for _ in texts]
    monkeypatch.setattr(processing,'embed',embeddings)
    def answer(settings, question, evidence, **kwargs):
        result = {'answer': 'Cedar lends three books for fourteen days.', 'sources': evidence, 'insufficient_evidence': False}
        if kwargs.get('learning_plan'):
            return [{'title': title, **({'topics': [{'title': 'Borrowing', **result}], 'answer': '', 'sources': []}
                                       if title == 'Main Topics' else result)} for title in processing.PLAN_PARTS]
        return result
    monkeypatch.setattr(processing, 'grounded_answer', answer)
    return calls


def test_persistence_ownership_and_private_files(context):
    settings,users,client,notebook=context
    document=upload(context)
    other=users[1]['headers']; owner=users[0]['headers']
    for method,path,kwargs in [('get',f'/{notebook}',{}),('patch',f'/{notebook}',{'json':{'title':'stolen'}}),('delete',f'/{notebook}',{}),('get',f"/sources/{document['id']}/file",{}),('post',f"/sources/{document['id']}/cancel",{}),('post',f"/sources/{document['id']}/retry",{}),('patch',f"/sources/{document['id']}/progress",{'json':{'learned':True}}),('post',f'/{notebook}/documents?filename=stolen.txt',{'content':b'stolen'}),('post',f'/{notebook}/questions',{'json':{'id':str(uuid4()),'question':'Read secrets','document_ids':[document['id']]}})]:
        assert getattr(client,method)('/api/notebooks'+path,headers=other,**kwargs).status_code==404
    assert client.patch('/api/notebooks/'+notebook,headers=owner,json={'title':'Renamed notebook'}).status_code==200
    with TestClient(create_app(settings)) as another_device:
        restored=another_device.get('/api/notebooks/'+notebook,headers=owner).json()
        assert restored['notebook']['title']=='Renamed notebook'
        assert restored['documents'][0]['id']==document['id']
    base=str(settings.supabase_url).rstrip('/')
    public={'apikey':settings.supabase_publishable_key.get_secret_value()}
    response=httpx.get(base+'/rest/v1/notebooks',headers={**public,**other},params={'id':'eq.'+notebook},timeout=15)
    assert response.status_code==200 and response.json()==[]
    path='/storage/v1/object/authenticated/study-material/'+document['storage_path']
    assert httpx.get(base+path,headers={**public,**other},timeout=15).status_code!=200
    assert client.get('/api/notebooks/sources/'+document['id']+'/file',headers=owner).status_code==200


def test_retry_resumes_index_and_persists_progress(context,monkeypatch):
    from app.notebooks import processing
    settings,users,client,notebook=context
    calls=fake_models(monkeypatch)
    original=processing.grounded_answer
    monkeypatch.setattr(processing,'grounded_answer',lambda *args, **kwargs: (_ for _ in ()).throw(ModelError('quota','Quota reached',True)))
    document=upload(context); job=claim_one(settings,document)
    with pytest.raises(ModelError): process(settings,job['id'],job['job_token'])
    with database(settings) as conn:
        fail(conn,job,'quota','Quota reached',True)
        row=conn.execute('select status,completed_chunks,error_code from public.documents where id=%s',(job['id'],)).fetchone()
    assert row['status']=='uploaded' and row['completed_chunks']==1 and row['error_code']=='quota'
    monkeypatch.setattr(processing,'grounded_answer',original)
    next_job=claim_one(settings,document); process(settings,next_job['id'],next_job['job_token'])
    assert calls==[1], 'Retry must reuse already persisted embeddings'
    response=client.patch('/api/notebooks/sources/'+document['id']+'/progress',headers=users[0]['headers'],json={'learned':True})
    assert response.status_code==200
    restored=client.get('/api/notebooks/'+notebook,headers=users[0]['headers']).json()['documents'][0]
    assert restored['status']=='ready' and restored['learned'] and restored['materials'][0]['sources']
    assert [p['title'] for p in restored['materials']] == list(processing.PLAN_PARTS)
    listings = client.get('/api/notebooks',headers=users[0]['headers']).json()
    assert next(n['xp'] for n in listings if n['id']==notebook) == 100


def test_cancellation_fences_stale_worker(context,monkeypatch):
    settings,users,client,_=context
    fake_models(monkeypatch)
    document=upload(context); job=claim_one(settings,document)
    assert client.post('/api/notebooks/sources/'+document['id']+'/cancel',headers=users[0]['headers']).status_code==200
    with pytest.raises(Cancelled): process(settings,job['id'],job['job_token'])
    assert client.post('/api/notebooks/sources/'+document['id']+'/retry',headers=users[0]['headers']).status_code==200
    new_job=claim_one(settings,document)
    with pytest.raises(Cancelled): process(settings,job['id'],job['job_token'])
    process(settings,new_job['id'],new_job['job_token'])


def test_failed_storage_delete_retains_recoverable_metadata(context,monkeypatch):
    from app.api.routes import notebooks
    from fastapi import HTTPException
    settings,users,client,notebook=context
    upload(context)
    original=notebooks.storage
    def unavailable(*args,**kwargs): raise HTTPException(503,'Storage unavailable')
    monkeypatch.setattr(notebooks,'storage',unavailable)
    assert client.delete('/api/notebooks/'+notebook,headers=users[0]['headers']).status_code==503
    with database(settings) as conn:
        assert conn.execute('select deleting from public.notebooks where id=%s',(notebook,)).fetchone()['deleting']
        assert conn.execute('select count(*) as count from public.documents where notebook_id=%s',(notebook,)).fetchone()['count']==1
    monkeypatch.setattr(notebooks,'storage',original)
    assert client.delete('/api/notebooks/'+notebook,headers=users[0]['headers']).status_code==200


def test_expired_lease_recovers_after_restart(context):
    settings,_,_,_=context
    document=upload(context); old=claim_one(settings,document)
    with database(settings) as conn:
        others=conn.execute("select count(*) as count from public.documents where notebook_id is not null and id<>%s and status in ('uploaded','processing')",(document['id'],)).fetchone()['count']
        if others: pytest.skip('Do not claim unrelated user jobs during recovery test')
        conn.execute("update public.documents set lease_until=now()-interval '1 second' where id=%s",(document['id'],))
        conn.commit()
        recovered=claim(conn,900)
        assert recovered['id']==old['id'] and recovered['job_token']!=old['job_token']
        assert recovered['attempts']==2
        fail(conn,recovered,'timeout','Retry limit test',True)
        conn.execute("update public.documents set available_at=now() where id=%s",(document['id'],)); conn.commit()
        final=claim(conn,900)
        fail(conn,final,'timeout','Retry limit test',True)
        assert conn.execute('select status from public.documents where id=%s',(document['id'],)).fetchone()['status']=='failed'


def test_real_worker_subprocess_reports_parsing_failure(context):
    settings,_,_,_=context
    document=upload(context,'broken.pdf',b'%PDF-broken fixture')
    with database(settings) as conn:
        others=conn.execute("select count(*) as count from public.documents where notebook_id is not null and id<>%s and status in ('uploaded','processing')",(document['id'],)).fetchone()['count']
    if others: pytest.skip('Do not claim unrelated jobs during worker test')
    assert run_once(settings)
    with database(settings) as conn:
        row=conn.execute('select status,error_code,attempts from public.documents where id=%s',(document['id'],)).fetchone()
    assert row == {'status':'failed','error_code':'invalid_pdf','attempts':1}


@pytest.mark.skipif(os.getenv('NOTEBOOK_LIVE_GEMINI')!='1',reason='Bounded provider test is separately opt-in')
def test_live_pdf_txt_learning_chat_and_refresh(context):
    from app.notebooks import gemini
    settings,users,client,notebook=context
    documents=[]
    for filename in ('cedar.txt','cedar.pdf'):
        document=upload(context,filename,(Path(__file__).parent/'fixtures'/filename).read_bytes())
        job=claim_one(settings,document)
        process(settings,job['id'],job['job_token'])
        documents.append(document)
    owner=users[0]['headers']
    turn_id=str(uuid4())
    payload={'id':turn_id,'question':'How many books can members borrow, for how long, and what is the late return charge?', 'document_ids':[d['id'] for d in documents]}
    response=client.post('/api/notebooks/'+notebook+'/questions',headers=owner,json=payload)
    assert response.status_code==200,response.text
    turn=response.json()
    assert 'three' in turn['answer'].lower() or '3' in turn['answer']
    assert 'fourteen' in turn['answer'].lower() or '14' in turn['answer']
    assert 'two' in turn['answer'].lower() or '2' in turn['answer']
    assert any(source['page_number']==2 for source in turn['sources'])
    # Repeating the same request returns the saved answer, without another model call.
    assert client.post('/api/notebooks/'+notebook+'/questions',headers=owner,json=payload).json()['id']==turn_id
    with TestClient(create_app(settings)) as second_device:
        restored=second_device.get('/api/notebooks/'+notebook,headers=owner).json()
        assert restored['turns'][0]['id']==turn_id and all(d['materials'] for d in restored['documents'])
    payload['id']=str(uuid4()); payload['question']='What is the name of the current mayor of Cedar?'
    response=client.post('/api/notebooks/'+notebook+'/questions',headers=owner,json=payload)
    assert response.status_code==200,response.text
    assert 'not provide enough evidence' in response.json()['answer']
