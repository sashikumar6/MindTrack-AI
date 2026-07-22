"""Test environment bootstrap.

This module's top-level code runs before pytest imports any sibling test
module in this directory (pytest always loads conftest.py first), so setting
DATABASE_URL here -- before anything imports config.settings / db.database /
api.main -- is what actually makes a test database take effect. Those
modules build a module-level engine/settings singleton at import time, so
monkeypatching *after* import (fine for a simple bool like DEMO_MODE, see the
existing tests) has no effect on an already-built SQLAlchemy engine.
"""
import os
from pathlib import Path

_TEST_DB_PATH = Path(__file__).resolve().parent / "test_mindtrack.db"
_TEST_DB_PATH.unlink(missing_ok=True)

os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TEST_DB_PATH}")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("SESSION_SECRET_KEY", "test-session-secret")
# A fixed, valid Fernet key -- fine to hardcode, it only ever protects
# throwaway data in the test sqlite file created (and deleted) above.
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", "GxHLSZvkGMky40EHXiiFo-RNd8yvpT9VHt0D4nQhDGM=")

from db.database import init_db  # noqa: E402

init_db()
