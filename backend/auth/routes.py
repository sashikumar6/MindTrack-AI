"""Google OAuth login/callback/logout/me routes.

Login and the Gmail job-tracker consent are combined into a single OAuth
grant (see auth/oauth.py's scopes) per product decision -- there is no
separate "connect Gmail later" flow. A user who denies the Gmail scope (or
whose Google Workspace admin blocks it) still gets an account; the job
tracker simply has nothing to scan for them.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from agents.personas import is_valid_conversation_mode, is_valid_persona
from auth.crypto import encrypt
from auth.deps import get_current_user
from auth.oauth import oauth
from config.settings import settings
from db.database import get_session
from db.models import GoogleCredential, User
from voice.elevenlabs_tts import OPENAI_TTS_VOICES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _me_payload(user: User) -> dict:
    with get_session() as session:
        cred = session.execute(
            select(GoogleCredential).where(GoogleCredential.user_id == user.id)
        ).scalar_one_or_none()
        gmail_connected = bool(cred and cred.refresh_token_enc)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture_url": user.picture_url,
        "gmail_connected": gmail_connected,
        "persona_mode": user.persona_mode,
        "conversation_mode": user.conversation_mode,
        "tts_voice": user.tts_voice,
        "tts_provider": settings.TTS_PROVIDER,
    }


@router.get("/login")
async def login(request: Request):
    return await oauth.google.authorize_redirect(request, settings.OAUTH_REDIRECT_URL)


@router.get("/callback")
async def callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as exc:
        logger.warning("Google OAuth callback failed: %s", exc)
        return RedirectResponse(f"{settings.FRONTEND_URL}/login?error=oauth_failed")

    userinfo = token.get("userinfo") or {}
    google_sub = userinfo.get("sub")
    email = userinfo.get("email")
    if not google_sub or not email:
        return RedirectResponse(f"{settings.FRONTEND_URL}/login?error=missing_profile")

    name = userinfo.get("name")
    picture = userinfo.get("picture")
    access_token = token.get("access_token")
    refresh_token = token.get("refresh_token")
    expires_in = token.get("expires_in")
    expiry = datetime.utcnow() + timedelta(seconds=expires_in) if expires_in else None
    scope = token.get("scope", "")

    with get_session() as session:
        user = session.execute(
            select(User).where(User.google_sub == google_sub)
        ).scalar_one_or_none()
        if user is None:
            user = User(google_sub=google_sub, email=email, name=name, picture_url=picture)
            session.add(user)
        else:
            user.email = email
            user.name = name
            user.picture_url = picture
        user.last_login_at = datetime.utcnow()
        session.flush()
        user_id = user.id

        if access_token:
            cred = session.execute(
                select(GoogleCredential).where(GoogleCredential.user_id == user_id)
            ).scalar_one_or_none()
            if cred is None:
                cred = GoogleCredential(user_id=user_id, access_token_enc=encrypt(access_token))
                session.add(cred)
            else:
                cred.access_token_enc = encrypt(access_token)
            # Google only issues a refresh_token on first consent unless
            # prompt=consent forces it (set in oauth.py) -- guard anyway so a
            # re-login response missing one never blanks out a stored value.
            if refresh_token:
                cred.refresh_token_enc = encrypt(refresh_token)
            cred.token_expiry = expiry
            cred.scopes = scope

    request.session["user_id"] = user_id
    return RedirectResponse(settings.FRONTEND_URL)


@router.post("/logout")
async def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return _me_payload(user)


class UpdateMeRequest(BaseModel):
    persona_mode: str | None = None
    conversation_mode: str | None = None
    tts_voice: str | None = None


@router.patch("/me")
async def update_me(body: UpdateMeRequest, user: User = Depends(get_current_user)):
    if body.persona_mode is None and body.conversation_mode is None and body.tts_voice is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    if body.persona_mode is not None and not is_valid_persona(body.persona_mode):
        raise HTTPException(status_code=422, detail=f"Invalid persona_mode: {body.persona_mode}")
    if body.conversation_mode is not None and not is_valid_conversation_mode(body.conversation_mode):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid conversation_mode: {body.conversation_mode}",
        )
    if body.tts_voice is not None and body.tts_voice not in OPENAI_TTS_VOICES:
        raise HTTPException(status_code=422, detail=f"Invalid tts_voice: {body.tts_voice}")

    with get_session() as session:
        row = session.execute(select(User).where(User.id == user.id)).scalar_one()
        if body.persona_mode is not None:
            row.persona_mode = body.persona_mode
        if body.conversation_mode is not None:
            row.conversation_mode = body.conversation_mode
        if body.tts_voice is not None:
            row.tts_voice = body.tts_voice
        session.flush()
        user.persona_mode = row.persona_mode
        user.conversation_mode = row.conversation_mode
        user.tts_voice = row.tts_voice
    return _me_payload(user)
