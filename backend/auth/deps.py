"""FastAPI auth dependencies backed by a signed session cookie (Starlette
SessionMiddleware) holding just a user_id.

Two HTTP dependencies exist because some endpoints must keep serving
anonymous demo traffic (DEMO_MODE) alongside authenticated users:
  - get_current_user           -> 401s if not logged in
  - get_current_user_optional  -> returns None if not logged in

get_current_user_ws is for WebSocket routes (Phase 4): raising HTTPException
inside a websocket dependency does not translate to a clean WS close, so it
returns None instead and the route itself closes the socket (code 4401).
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, WebSocket
from sqlalchemy import select

from db.database import get_session
from db.models import User


def _load_user(user_id: int) -> User | None:
    with get_session() as session:
        user = session.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
        if user is not None:
            session.expunge(user)
        return user


async def get_current_user_optional(request: Request) -> User | None:
    user_id = request.session.get("user_id")
    if user_id is None:
        return None
    return _load_user(user_id)


async def get_current_user(
    user: User | None = Depends(get_current_user_optional),
) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def get_current_user_ws(websocket: WebSocket) -> User | None:
    user_id = websocket.session.get("user_id")
    if user_id is None:
        return None
    return _load_user(user_id)
