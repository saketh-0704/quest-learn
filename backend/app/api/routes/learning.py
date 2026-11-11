import json
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import ValidationError
from app.auth.dependencies import VerifiedUser
from app.schemas.learning import UnderstandText, TextAnswer, DocumentUpload, DocumentLearning
from app.services.text_learning import understand_text

router = APIRouter(prefix="/learning", tags=["learning"])


@router.post("/understand", response_model=TextAnswer)
async def understand(request: Request, response: Response, user: VerifiedUser):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 64 * 1024 * 1024:
            raise HTTPException(413, "Study text is too large.")
    try:
        payload = UnderstandText.model_validate(json.loads(body))
    except (ValueError, ValidationError):
        raise HTTPException(422, "Enter at least 40 characters of study text and a question of 3–1,000 characters.") from None
    response.headers["Cache-Control"] = "no-store"
    return await understand_text(payload, request.app.state.settings)


@router.post('/document', response_model=DocumentLearning)
async def learn_document(request: Request, response: Response, user: VerifiedUser):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 14_100_000:
            raise HTTPException(413, 'Choose a PDF or TXT file up to 10 MB.')
        body.extend(chunk)
    try:
        payload = DocumentUpload.model_validate_json(body)
    except ValidationError:
        raise HTTPException(422, 'Choose a PDF or TXT file, a learning goal up to 1,000 characters, and a valid difficulty.') from None
    response.headers['Cache-Control'] = 'no-store'
    return await understand_text(payload, request.app.state.settings)
