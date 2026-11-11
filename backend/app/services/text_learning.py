"""Bounded, disposable RAG process: no shared user index or model SDK in the API."""
import asyncio
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore

from fastapi import HTTPException
from pydantic import ValidationError

from app.config import Settings
from app.schemas.learning import UnderstandText, TextAnswer, DocumentUpload, DocumentLearning

_capacity = BoundedSemaphore(1)
WORKER = Path(__file__).resolve().parents[2] / "workers/gemini_text.py"


async def understand_text(payload: UnderstandText | DocumentUpload, settings: Settings) -> TextAnswer | DocumentLearning:
    if not settings.gemini_api_key or not settings.rag_python.is_file():
        raise HTTPException(503, "Text understanding is not configured. Add the Gemini key and install the RAG worker.")
    if not _capacity.acquire(blocking=False):
        raise HTTPException(429, "Text understanding is busy. Please try again shortly.")
    process = None
    try:
        with TemporaryDirectory(prefix="questlearn-text-") as directory:
            environment = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOME"}}
            environment.update({
                "GEMINI_API_KEY": settings.gemini_api_key.get_secret_value(),
                "GEMINI_MODEL": settings.gemini_model,
                "GEMINI_EMBEDDING_MODEL": settings.gemini_embedding_model,
                "PYTHONIOENCODING": "utf-8",
                "PATH": str(settings.rag_python.parent) + os.pathsep + environment.get("PATH", ""),
            })
            try:
                process = await asyncio.create_subprocess_exec(
                    str(settings.rag_python), str(WORKER), cwd=directory, env=environment,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL, limit=65536,
                )
                output, _ = await asyncio.wait_for(process.communicate(payload.model_dump_json().encode()), settings.rag_timeout_seconds)
                if process.returncode or len(output) > 64 * 1024 * 1024:
                    raise HTTPException(502, "Text understanding failed. Check the Gemini configuration and try again.")
                result = json.loads(output)
                if not isinstance(result, dict):
                    raise ValueError('Invalid worker response')
                if result.get('error') == 'invalid_document':
                    raise HTTPException(422, result.get('message', 'The document could not be read.'))
                if "error" in result:
                    raise HTTPException(502, "Gemini could not process this text. Check model access and quota, or try a shorter text.")
                return (DocumentLearning if isinstance(payload, DocumentUpload) else TextAnswer).model_validate(result)
            except TimeoutError:
                raise HTTPException(504, "Text understanding timed out. Try a shorter text.") from None
            except (OSError, ValueError, ValidationError):
                raise HTTPException(502, "The text-understanding worker is unavailable.") from None
            finally:
                if process is not None and process.returncode is None:
                    process.kill()
                    await process.wait()
    finally:
        _capacity.release()
