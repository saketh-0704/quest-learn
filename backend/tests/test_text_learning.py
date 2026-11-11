import asyncio
import json
from pathlib import Path
from uuid import UUID
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app.auth.dependencies import require_user
from app.schemas.auth import CurrentUser
from app.services import text_learning


TEXT = 'Plants use sunlight, water, and carbon dioxide to make sugars through photosynthesis.'

def test_default_worker_is_inside_project():
    assert Settings(_env_file=None).rag_python == Path(__file__).resolve().parents[2] / '.local/raganything/.venv/Scripts/python.exe'

def app(configured=True):
    settings = Settings(_env_file=None, gemini_api_key='test-only' if configured else None, rag_python=Path(__file__))
    application = create_app(settings)
    application.dependency_overrides[require_user] = lambda: CurrentUser(id=UUID('10000000-0000-0000-0000-000000000001'))
    return application


def test_authentication_required():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.post('/api/learning/understand', json={'text': TEXT, 'question': 'Explain this.'}).status_code == 401


def test_unconfigured_is_honest():
    with TestClient(app(False)) as client:
        assert client.post('/api/learning/understand', json={'text': TEXT, 'question': 'Explain this.'}).status_code == 503


@pytest.mark.parametrize('payload', [
    {'text': 'short', 'question': 'Why?'},
    {'text': TEXT, 'question': 'Why?', 'user_id': 'other-user'},
    {'text': TEXT + '\x00', 'question': 'Why?'},
])
def test_validation(payload):
    with TestClient(app()) as client:
        assert client.post('/api/learning/understand', json=payload).status_code == 422


def test_body_limit():
    with TestClient(app()) as client:
        assert client.post('/api/learning/understand', content=b'x' * (64 * 1024 * 1024 + 1)).status_code == 413


def test_worker_isolation_and_cleanup(monkeypatch):
    directories = []
    async def spawn(*args, **kwargs):
        assert 'test-only' not in args
        assert kwargs['env']['GEMINI_API_KEY'] == 'test-only'
        assert 'SUPABASE_SECRET_KEY' not in kwargs['env']
        directory = Path(kwargs['cwd']); directories.append(directory)
        (directory / 'private-text').write_text(TEXT)
        async def communicate(payload):
            assert json.loads(payload)['text'] == TEXT
            return b'{"answer":"Explanation from the test worker."}', b''
        return SimpleNamespace(returncode=0, communicate=communicate)
    monkeypatch.setattr(text_learning.asyncio, 'create_subprocess_exec', spawn)
    with TestClient(app()) as client:
        for _ in range(2):
            result = client.post('/api/learning/understand', json={'text': TEXT, 'question': 'Explain this.'})
            assert result.status_code == 200
            assert result.headers['cache-control'] == 'no-store'
    assert directories[0] != directories[1]
    assert all(not directory.exists() for directory in directories)


def test_timeout_kills_worker_and_cleans_files(monkeypatch):
    process = SimpleNamespace(returncode=None, killed=False)
    paths = []
    async def communicate(payload):
        raise TimeoutError()
    def kill():
        process.killed = True
        process.returncode = -1
    async def wait():
        return -1
    process.communicate, process.kill, process.wait = communicate, kill, wait
    async def spawn(*args, **kwargs):
        paths.append(Path(kwargs['cwd']))
        return process
    monkeypatch.setattr(text_learning.asyncio, 'create_subprocess_exec', spawn)
    with TestClient(app()) as client:
        assert client.post('/api/learning/understand', json={'text': TEXT, 'question': 'Explain this.'}).status_code == 504
    assert process.killed and not paths[0].exists()


def test_busy_rejected():
    text_learning._capacity.acquire()
    try:
        with TestClient(app()) as client:
            assert client.post('/api/learning/understand', json={'text': TEXT, 'question': 'Explain this.'}).status_code == 429
    finally:
        text_learning._capacity.release()
