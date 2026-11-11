"""Run with isolated interpreter: real RAG pipeline, fake Gemini responses, no paid calls."""
import asyncio
import importlib.util
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from google import genai

worker_path = Path(__file__).resolve().parents[1] / 'workers/gemini_text.py'
spec = importlib.util.spec_from_file_location('gemini_text', worker_path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
calls = []

async def generate_content(**kwargs):
    calls.append('generate')
    if kwargs['contents'] == 'What is photosynthesis?':
        assert 'Photosynthesis converts light' in kwargs['config'].system_instruction
        calls.append('grounded-query')
        return SimpleNamespace(text='Test-only explanation. ' * 400)
    # No entities; the final naive query still retrieves text chunks.
    return SimpleNamespace(text='Test-only explanation. <|COMPLETE|>')

async def embed_content(**kwargs):
    calls.append('embed')
    return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0] * 768) for _ in kwargs['contents']])

async def close():
    pass

fake = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content, embed_content=embed_content), aclose=close), close=lambda: None)
original = Path.cwd()
os.environ['PATH'] = str(Path(sys.executable).parent) + os.pathsep + os.environ.get('PATH', '')
with TemporaryDirectory(prefix='questlearn-smoke-') as directory:
    try:
        os.chdir(directory)
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'fake-test-key', 'GEMINI_MODEL': 'test-model', 'GEMINI_EMBEDDING_MODEL': 'test-embedding'}), patch.object(genai, 'Client', return_value=fake):
            answer = asyncio.run(worker.run({'text': 'Plants use sunlight and water to make sugars. Photosynthesis converts light into stored chemical energy.', 'question': 'What is photosynthesis?'}))
        assert answer['answer'] == 'Test-only explanation. ' * 400
        assert 'embed' in calls and 'grounded-query' in calls
    finally:
        os.chdir(original)
assert not Path(directory).exists()
print('Real RAG insertion/query pipeline passed with mocked Gemini; no answer-quality claim.')
