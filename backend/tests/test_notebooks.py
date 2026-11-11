from uuid import uuid4
from io import BytesIO
import httpx
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from app.config import Settings
from app.main import create_app
from app.documents.processing import extract_document, DocumentError, ProcessingLimits
from app.notebooks import gemini
from app.notebooks.gemini import validate_answer, ModelError, grounded_answer, generate_practice
import json


@pytest.mark.parametrize('method,path', [('get',''),('post',''),('get','/ID'),('patch','/ID'),('delete','/ID'),('post','/ID/documents'),('post','/ID/questions'),('get','/sources/ID/file'),('post','/sources/ID/retry'),('post','/sources/ID/cancel'),('patch','/sources/ID/progress')])
def test_every_notebook_operation_requires_auth(method, path):
    with TestClient(create_app(Settings(_env_file=None))) as client:
        response = getattr(client, method)('/api/notebooks' + path.replace('ID',str(uuid4())))
        assert response.status_code == 401


def test_practice_requires_auth():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.post(f'/api/notebooks/sources/{uuid4()}/practice').status_code == 401


@pytest.mark.parametrize('statuses,error_code', [
    ([503, 502, 200], None),
    ([503, 503, 503], 'provider_unavailable'),
    ([429], 'quota'),
    ([403], 'provider_request'),
])
def test_gemini_retries_only_transient_server_errors(monkeypatch, statuses, error_code):
    responses = iter(statuses)
    delays = []
    monkeypatch.setattr(gemini.httpx, 'post', lambda *args, **kwargs: httpx.Response(next(responses), json={'ok': True}))
    monkeypatch.setattr(gemini, 'sleep', delays.append)
    settings = Settings(_env_file=None, gemini_api_key='test-key')
    if error_code:
        with pytest.raises(ModelError) as failure:
            gemini.call(settings, settings.gemini_model, 'generateContent', {})
        assert failure.value.code == error_code
    else:
        assert gemini.call(settings, settings.gemini_model, 'generateContent', {}) == {'ok': True}
    assert len(delays) == len(statuses) - 1
    assert all(2 ** i <= delay < 2 ** i + 1 for i, delay in enumerate(delays))


def test_practice_restores_citations_and_rejects_invalid_answers(monkeypatch):
    source = {'chunk_id': str(uuid4()), 'content': 'Cedar lends books for fourteen days.'}
    card = {'prompt': 'How long is the loan?', 'answer': 'Fourteen days.', 'source_id': 'S1'}
    cards = [card, *[{**card, 'prompt': f'Card {i}'} for i in range(2, 31)]]
    quiz = {**card, 'options': ['Seven days', 'Fourteen days', 'Twenty days'], 'correct_index': 1}
    questions = [quiz, *[{**quiz, 'prompt': f'Question {i}'} for i in range(2, 21)]]
    branch = {'label': 'Borrowing', 'relation': 'Sets the loan period.', 'concepts': ['Fourteen days'], 'source_id': 'S1'}
    models = []
    def fake_call(settings, model, *args):
        models.append(model)
        if len(models) == 1:
            raise ModelError('provider_unavailable', 'Gemini is temporarily unavailable.', True)
        return {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
            {'text': json.dumps({'flashcards': cards, 'quiz': questions,
                                 'mind_map': {'title': 'Library policy', 'branches': [branch]}})}]}}]}
    monkeypatch.setattr('app.notebooks.gemini.call', fake_call)
    materials = [{'topics': [{'sources': [source]}]}]
    settings = Settings(_env_file=None, gemini_model='primary', gemini_quiz_fallback_model='fallback')
    practice = generate_practice(settings, materials)
    assert models == ['primary', 'fallback']
    assert len(practice['flashcards']) == 30
    assert practice['flashcards'][0]['source'] == source
    assert practice['quiz'][0]['correct_index'] == 1
    assert len(practice['quiz']) == 20
    assert practice['mind_map']['branches'][0]['source'] == source
    last_card = cards[-1]
    cards[-1] = {**card, 'prompt': '  HOW LONG IS THE LOAN?  '}
    with pytest.raises(ModelError, match='incomplete practice'):
        generate_practice(settings, materials)
    cards[-1] = last_card
    last_question = questions.pop()
    with pytest.raises(ModelError, match='incomplete practice'):
        generate_practice(Settings(_env_file=None), materials)
    questions.append({**quiz, 'prompt': '  HOW LONG IS THE LOAN?  '})
    with pytest.raises(ModelError, match='incomplete practice'):
        generate_practice(Settings(_env_file=None), materials)
    questions[-1] = last_question
    branch['source_id'] = 'unknown'
    with pytest.raises(ModelError, match='incomplete practice'):
        generate_practice(Settings(_env_file=None), materials)
    branch['source_id'] = 'S1'
    for changes in ({'source_id': 'S2'}, {'source_id': 'S1', 'correct_index': 3}):
        quiz.update(changes)
        with pytest.raises(ModelError, match='incomplete practice'):
            generate_practice(Settings(_env_file=None), materials)


def test_citations_cannot_be_invented_or_omitted():
    evidence = [{'chunk_id':'real','content':'The Cedar library lends three books.'}]
    for keys in (['invented'], []):
        with pytest.raises(ModelError, match='verified'):
            validate_answer({'answer':'Three books.', 'source_ids':keys, 'insufficient_evidence':False}, evidence)
    result = validate_answer({'answer':'Three books.', 'source_ids':['real','real'], 'insufficient_evidence':False}, evidence)
    assert result['sources'] == evidence


def test_no_evidence_does_not_call_provider():
    result = grounded_answer(Settings(_env_file=None), 'Who won?', [])
    assert result['insufficient_evidence'] and result['sources'] == []


def test_introduction_is_rewritten_once_with_both_batches_and_keeps_checkpoint(monkeypatch):
    from app.notebooks import processing
    first = {'chunk_id': 'first', 'content': 'Lexical semantics studies word meaning.'}
    second = {'chunk_id': 'second', 'content': 'Parsing studies sentence structure.'}
    prior = {'title': 'Introduction', 'answer': 'Welcome to lexical semantics.', 'sources': [first],
             'insufficient_evidence': False, 'covered_chunks': 8}
    part = {'answer': 'Welcome to parsing.', 'sources': [first, second], 'insufficient_evidence': False}
    def answer(settings, question, evidence):
        assert evidence == [first, second]
        return {'answer': 'Study word meaning and sentence structure.', 'sources': evidence,
                'insufficient_evidence': False}
    monkeypatch.setattr(processing, 'grounded_answer', answer)
    processing.combine_introduction(None, prior, part)
    assert prior['answer'] == 'Study word meaning and sentence structure.'
    assert prior['covered_chunks'] == 8
    assert prior['sources'] == [first, second]
    snapshot = dict(prior)
    def fail(*args):
        raise ModelError('quota', 'Retry later', True)
    monkeypatch.setattr(processing, 'grounded_answer', fail)
    with pytest.raises(ModelError):
        processing.combine_introduction(None, prior, part)
    assert prior == snapshot


def test_overlapping_topic_paragraphs_and_citations_are_not_duplicated():
    from app.notebooks.processing import merge_text
    source = {'chunk_id': 'same'}
    prior = {'answer': 'Definition.\n\nExample.', 'sources': [source], 'insufficient_evidence': False}
    part = {'answer': 'Example.\n\nNew detail.', 'sources': [source], 'insufficient_evidence': False}
    merge_text(prior, part)
    assert prior['answer'] == 'Definition.\n\nExample.\n\nNew detail.'
    assert prior['sources'] == [source]


def test_multibatch_plan_resumes_after_failed_introduction_merge(monkeypatch):
    from contextlib import contextmanager
    from copy import deepcopy
    from types import SimpleNamespace
    from app.notebooks import processing
    from uuid import uuid4
    document_id = uuid4()
    rows = [{'chunk_id': uuid4(), 'document_id': document_id, 'content': f'Fact {i}', 'page_number': i + 1}
            for i in range(17)]
    document = {'materials': [], 'storage_path': 'test', 'filename': 'test.txt',
                'content_type': 'text/plain', 'embedding_model': 'test', 'user_id': uuid4()}
    class Connection:
        def execute(self, query, params=()):
            if query.startswith('select d.* from public.documents'):
                return SimpleNamespace(fetchone=lambda: deepcopy(document))
            if query.startswith('select 1 from public.documents'):
                return SimpleNamespace(fetchone=lambda: {'?column?': 1})
            if query.startswith('select chunk_index'):
                return SimpleNamespace(fetchall=lambda: [{'chunk_index': i} for i in range(17)])
            if query.startswith('select id as chunk_id'):
                return SimpleNamespace(fetchall=lambda: rows)
            if query.startswith('update public.documents set materials='):
                document['materials'] = deepcopy(params[0].obj)
    @contextmanager
    def database(settings):
        yield Connection()
    monkeypatch.setattr(processing, 'database', database)
    monkeypatch.setattr(processing, 'storage', lambda *args: SimpleNamespace(content=b'test'))
    monkeypatch.setattr(processing, 'extract_document', lambda *args: SimpleNamespace(
        empty_pages=[], page_count=17, chunks=[SimpleNamespace(index=i) for i in range(17)]))
    batches = []
    fail_merge = True
    def generate(settings, question, evidence, **kwargs):
        if kwargs.get('learning_plan'):
            batches.append(evidence[0]['page_number'])
            result = {'answer': 'Welcome to this batch.', 'sources': evidence, 'insufficient_evidence': False}
            return [{'title': title, **({'topics': [{'title': 'Facts', **result}], 'answer': '', 'sources': []}
                                       if title == 'Main Topics' else result)} for title in processing.PLAN_PARTS]
        if fail_merge:
            raise ModelError('quota', 'Retry later', True)
        return {'answer': 'One overview of all facts.', 'sources': evidence, 'insufficient_evidence': False}
    monkeypatch.setattr(processing, 'grounded_answer', generate)
    settings = SimpleNamespace(gemini_embedding_model='test')
    with pytest.raises(ModelError):
        processing.process(settings, document_id, uuid4())
    assert document['materials'][0]['covered_chunks'] == 8
    fail_merge = False
    processing.process(settings, document_id, uuid4())
    assert batches == [1, 9, 9, 17]
    assert document['materials'][0]['answer'] == 'One overview of all facts.'
    assert document['materials'][0]['covered_chunks'] == 17
    assert len(document['materials'][1]['topics']) == 1
    assert len(document['materials'][1]['topics'][0]['sources']) == 17
    # A saved old plan is repaired without regenerating completed batches.
    document['materials'][0].pop('intro_version')
    document['materials'][0]['answer'] = 'Welcome.\n\nWelcome again.'
    processing.process(settings, document_id, uuid4())
    assert batches == [1, 9, 9, 17]
    assert document['materials'][0]['answer'] == 'One overview of all facts.'
    assert document['materials'][0]['intro_version'] == 2


def test_empty_model_abstention_becomes_an_honest_explanation():
    result = validate_answer({'answer':'', 'source_ids':[], 'insufficient_evidence':True}, [])
    assert result['answer'] == 'The selected sources do not provide enough evidence.'
    with pytest.raises(ModelError):
        validate_answer({'answer':'', 'source_ids':['real'], 'insufficient_evidence':False}, [{'chunk_id':'real'}])


def test_transaction_pooler_is_rejected_before_acquiring_session_locks():
    from fastapi import HTTPException
    from app.notebooks.store import database
    with pytest.raises(HTTPException, match='session pooler'):
        with database(Settings(_env_file=None,database_url='postgresql://test@localhost:6543/postgres')):
            pytest.fail('Must not connect to a transaction pooler')


@pytest.mark.parametrize('storage_fails', [False, True])
def test_upload_commits_recovery_record_before_using_storage(monkeypatch, storage_fails):
    from contextlib import nullcontext
    from unittest.mock import Mock, call
    from fastapi import HTTPException
    from app.api.routes import notebooks

    row = {'id': uuid4(), 'storage_path': 'private/source.txt'}
    conn = Mock()
    conn.execute.return_value.fetchone.return_value = row
    database = Mock(return_value=nullcontext(conn))
    monkeypatch.setattr(notebooks, 'database', database)
    owned = Mock()
    monkeypatch.setattr(notebooks, 'owned_notebook', owned)

    def store(settings, method, path, **kwargs):
        conn.commit.assert_called_once()
        assert conn.execute.call_count == 1
        assert method == 'POST'
        assert path == '/private/source.txt'
        if storage_fails:
            raise HTTPException(503, 'Storage unavailable.')

    monkeypatch.setattr(notebooks, 'storage', store)
    notebook_id, user_id = uuid4(), uuid4()
    args = (None, notebook_id, user_id, 'source.txt', 'text/plain', b'Study notes.')
    if storage_fails:
        with pytest.raises(HTTPException, match='Storage unavailable'):
            notebooks.save_upload(*args)
    else:
        assert notebooks.save_upload(*args) == row
    database.assert_called_once()
    assert owned.call_args_list == [call(conn, notebook_id, user_id, lock=True)] * 2
    assert conn.execute.call_count == (1 if storage_fails else 2)


def test_model_can_only_select_retrieved_labels_and_server_restores_ids(monkeypatch):
    import json
    from app.notebooks import gemini
    source = {'chunk_id': str(uuid4()), 'content': 'Three books.', 'page_number': 2}
    def generate(settings, model, method, payload):
        assert payload['generationConfig']['responseJsonSchema']['properties']['source_ids']['items']['enum'] == ['S1']
        evidence = json.loads(payload['contents'][0]['parts'][0]['text'])['evidence']
        assert evidence[0]['chunk_id'] == 'S1'
        return {'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps({'answer':'Three books.','source_ids':['S1'],'insufficient_evidence':False})}]}}]}
    monkeypatch.setattr(gemini,'call',generate)
    result = grounded_answer(Settings(_env_file=None),'How many?', [source])
    assert result['sources'] == [source]


def test_large_utf8_text_is_chunked_without_truncation():
    text = ('Learning café facts. ' * 1100) + ' UNIQUE_FINAL_PASSAGE'
    result = extract_document('large.txt',text.encode(),'text/plain',ProcessingLimits(chunk_overlap=0,max_characters=None))
    assert len(result.chunks) > 6
    assert 'UNIQUE_FINAL_PASSAGE' in result.chunks[-1].content
    assert sum(len(c.content) for c in result.chunks) >= len(text)-len(result.chunks)
    assert all(c.page_number is None for c in result.chunks)


def test_four_part_plan_requires_every_step_and_valid_citations(monkeypatch):
    import json
    from app.notebooks import gemini
    source = {'chunk_id': 'original', 'content': 'Borrow three books.'}
    raw = {title: {'answer': 'Borrow three books.', 'source_ids': ['S1'], 'insufficient_evidence': False}
           for title in gemini.PLAN_PARTS}
    raw['Main Topics'] = [dict(raw['Introduction'], title='Borrowing limits'),
                          dict(raw['Introduction'], title='Renewals')]
    monkeypatch.setattr(gemini, 'call', lambda *args: {'candidates': [{'finishReason': 'STOP',
        'content': {'parts': [{'text': json.dumps(raw)}]}}]})
    def generate():
        return grounded_answer(Settings(_env_file=None), 'Make a plan', [source], learning_plan=True)
    parts = generate()
    assert [part['title'] for part in parts] == list(gemini.PLAN_PARTS)
    assert [t['title'] for t in parts[1]['topics']] == ['Borrowing limits', 'Renewals']
    assert all(t['sources'] == [source] for t in parts[1]['topics'])
    raw['Main Topics'][0]['source_ids'] = ['invented']
    with pytest.raises(ModelError, match='verified'):
        generate()
    raw['Main Topics'][0]['source_ids'] = ['S1']
    raw['Review']['source_ids'] = ['invented']
    with pytest.raises(ModelError, match='verified'):
        generate()
    del raw['Review']
    with pytest.raises(ModelError, match='incomplete'):
        generate()


@pytest.mark.parametrize('filename,data,mime,code', [('scan.pdf',None,'application/pdf','no_readable_text'),('bad.txt',b'\xff','text/plain','invalid_text_encoding'),('bad.pdf',b'%PDF-broken','application/pdf','invalid_pdf'),('wrong.doc',b'a','application/msword','unsupported_type')])
def test_actionable_parser_errors(filename,data,mime,code):
    if data is None:
        writer=PdfWriter(); writer.add_blank_page(width=200,height=200)
        out=BytesIO(); writer.write(out); data=out.getvalue()
    with pytest.raises(DocumentError) as error:
        extract_document(filename,data,mime)
    assert error.value.code == code
