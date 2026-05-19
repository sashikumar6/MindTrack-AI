"""One-time Gmail OAuth bootstrap.

Run this on your host (not inside Docker) once:

    cd backend
    python -m venv .venv && source .venv/bin/activate
    pip install google-auth-oauthlib google-api-python-client
    python scripts/auth_gmail.py

It opens a browser, you grant Gmail read access to your own account, and a
refresh-token-bearing `credentials/token.json` is written. The container
mounts `backend/` so it'll see the file on next start.
"""
from __future__ import annotations

import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
ROOT = Path(__file__).resolve().parent.parent
CLIENT_SECRETS = ROOT / "credentials" / "client_secret.json"
TOKEN_PATH = ROOT / "credentials" / "token.json"


def main() -> int:
    if not CLIENT_SECRETS.exists():
        print(f"ERROR: place your downloaded OAuth client JSON at {CLIENT_SECRETS}")
        return 1

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRETS), SCOPES)
    creds = flow.run_local_server(port=0)
    TOKEN_PATH.write_text(creds.to_json())
    print(f"Saved {TOKEN_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
