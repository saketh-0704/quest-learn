"""Verify identity at the Auth server; never trust client-decoded JWT claims."""

from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from app.schemas.auth import CurrentUser


bearer = HTTPBearer(auto_error=False)


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Your session is invalid or expired. Please sign in again.",
        headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"},
    )


async def require_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> CurrentUser:
    if credentials is None or len(credentials.credentials) > 8192:
        raise unauthorized()
    settings = request.app.state.settings
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise HTTPException(status_code=503, detail="Account services are not configured.")
    client: httpx.AsyncClient = request.app.state.auth_client
    try:
        response = await client.get(
            f"{str(settings.supabase_url).rstrip('/')}/auth/v1/user",
            headers={
                "apikey": settings.supabase_publishable_key.get_secret_value(),
                "Authorization": f"Bearer {credentials.credentials}",
            },
        )
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="Account verification is temporarily unavailable.") from None
    if response.status_code in {400, 401, 403, 404}:
        raise unauthorized()
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Account verification is temporarily unavailable.")
    try:
        data = response.json()
        if not isinstance(data, dict) or data.get("role") != "authenticated" or data.get("is_anonymous") is True:
            raise unauthorized()
        return CurrentUser.model_validate(data)
    except (ValueError, ValidationError):
        raise HTTPException(status_code=503, detail="Account verification returned an invalid response.") from None


VerifiedUser = Annotated[CurrentUser, Depends(require_user)]
