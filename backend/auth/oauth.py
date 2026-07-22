"""Google OAuth client registration (Authlib), used by auth/routes.py."""
from __future__ import annotations

from authlib.integrations.starlette_client import OAuth

from config.settings import settings

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": "openid email profile https://www.googleapis.com/auth/gmail.readonly",
        # Google only returns a refresh_token on the first consent unless
        # forced — always show the consent screen so re-auth (e.g. after a
        # revoke) still yields a refresh_token.
        "prompt": "consent",
        "access_type": "offline",
    },
)
