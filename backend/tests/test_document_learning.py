import base64
from types import SimpleNamespace

from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app
from app.services import text_learning
from test_text_learning import app


def payload():
    return {'filename': 'notes.txt', 'data': base64.b64encode(b'The Cedar library lends three books for fourteen days.').decode(), 'goal': 'Understand the rules', 'difficulty': 'Beginner'}


def test_document_requires_verified_auth():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.post('/api/learning/document', json=payload()).status_code == 401


def test_document_validation_and_size():
    with TestClient(app()) as client:
        for invalid in [dict(payload(), filename='../notes.txt'), dict(payload(), goal=''), dict(payload(), difficulty='unknown'), dict(payload(), owner='someone-else')]:
            assert client.post('/api/learning/document', json=invalid).status_code == 422
        assert client.post('/api/learning/document', content=b'x' * 14100001).status_code == 413


def test_invalid_document_error_is_actionable(monkeypatch):
    async def communicate(data):
        return b'{"error":"invalid_document","message":"Scanned PDFs need OCR."}', b''
    async def spawn(*args, **kwargs):
        return SimpleNamespace(returncode=0, communicate=communicate)
    monkeypatch.setattr(text_learning.asyncio, 'create_subprocess_exec', spawn)
    with TestClient(app()) as client:
        result = client.post('/api/learning/document', json=payload())
        assert result.status_code == 422
        assert 'OCR' in result.json()['detail']


def test_generated_document_response_validated(monkeypatch):
    import json
    async def communicate(data):
        assert json.loads(data)['filename'] == 'notes.txt'
        return json.dumps({'source': 'notes.txt', 'text': 'The Cedar library lends three books for fourteen days.', 'lessons': [{'title': title, 'content': 'The source says members may borrow three books for fourteen days.'} for title in ['Introduction', 'Concepts', 'Examples']]}).encode(), b''
    async def spawn(*args, **kwargs):
        return SimpleNamespace(returncode=0, communicate=communicate)
    monkeypatch.setattr(text_learning.asyncio, 'create_subprocess_exec', spawn)
    with TestClient(app()) as client:
        result = client.post('/api/learning/document', json=payload())
        assert result.status_code == 200
        assert len(result.json()['lessons']) == 3
        assert result.headers['cache-control'] == 'no-store'


def test_large_text_is_valid_for_lessons_and_followup_questions():
    from app.schemas.learning import DocumentLearning, UnderstandText
    text = 'A source paragraph with facts about library borrowing. ' * 12000
    lessons = [{'title': title, 'content': 'Library members borrow books and return them to the front desk.'} for title in ['Introduction', 'Concepts', 'Examples']]
    assert DocumentLearning(text=text, source='long.txt', lessons=lessons).text == text
    assert UnderstandText(text=text, question='Explain borrowing.').text == text.strip()
