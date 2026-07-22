"""add persona_mode and tts_voice to users

Revision ID: 0a7d76ee53d4
Revises: bfaa55379ead
Create Date: 2026-07-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a7d76ee53d4'
down_revision: Union[str, Sequence[str], None] = 'bfaa55379ead'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'users',
        sa.Column('persona_mode', sa.String(length=16), nullable=False, server_default='warm'),
    )
    op.add_column(
        'users',
        sa.Column('tts_voice', sa.String(length=16), nullable=False, server_default='marin'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'tts_voice')
    op.drop_column('users', 'persona_mode')
