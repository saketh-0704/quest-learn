from fastapi import APIRouter, Response

from app.auth.dependencies import VerifiedUser
from app.schemas.auth import CurrentUser


router = APIRouter(prefix="/auth", tags=["accounts"])


@router.get("/me", response_model=CurrentUser)
async def current_user(user: VerifiedUser, response: Response) -> CurrentUser:
    response.headers["Cache-Control"] = "no-store"
    return user
