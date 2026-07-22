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
        # No Gmail scope: gmail.readonly is a Google "restricted" scope that
        # requires a paid annual security assessment (CASA) to remove the
        # "unverified app" warning for arbitrary users. Dropping it keeps
        # sign-in on Google's basic (zero-review) scopes so anyone can sign
        # in immediately -- at the cost of the Job Tracker feature, which
        # has no Gmail access to scan. See DEPLOYMENT.md.
        "scope": "openid email profile",
        # Google only returns a refresh_token on the first consent unless
        # forced — always show the consent screen so re-auth (e.g. after a
        # revoke) still yields a refresh_token.
        "prompt": "consent",
        "access_type": "offline",
    },
)
