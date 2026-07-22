"""add conversation mode and expand persona presets

Revision ID: c2f4a1d7e9b0
Revises: 0a7d76ee53d4
Create Date: 2026-07-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2f4a1d7e9b0"
down_revision: Union[str, Sequence[str], None] = "0a7d76ee53d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "conversation_mode",
            sa.String(length=20),
            nullable=False,
            server_default="just_listen",
        ),
    )
    op.execute("UPDATE users SET persona_mode = 'empathetic' WHERE persona_mode = 'warm'")
    op.execute("UPDATE users SET persona_mode = 'calm' WHERE persona_mode = 'gentle'")
    op.alter_column("users", "persona_mode", server_default="empathetic")


def downgrade() -> None:
    op.execute("UPDATE users SET persona_mode = 'warm' WHERE persona_mode = 'empathetic'")
    op.execute("UPDATE users SET persona_mode = 'gentle' WHERE persona_mode = 'calm'")
    op.alter_column("users", "persona_mode", server_default="warm")
    op.drop_column("users", "conversation_mode")
