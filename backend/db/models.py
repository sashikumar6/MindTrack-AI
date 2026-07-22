from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    google_sub = Column(String(255), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255))
    picture_url = Column(Text)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    last_login_at = Column(DateTime)
    persona_mode = Column(String(16), nullable=False, default="warm", server_default="warm")
    tts_voice = Column(String(16), nullable=False, default="marin", server_default="marin")

    google_credential = relationship(
        "GoogleCredential",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class GoogleCredential(Base):
    """Per-user encrypted Google OAuth tokens, captured at login (combined
    identity + gmail.readonly consent). Access/refresh tokens are encrypted
    at rest with Fernet (auth/crypto.py) before being written here."""

    __tablename__ = "google_credentials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    access_token_enc = Column(LargeBinary, nullable=False)
    refresh_token_enc = Column(LargeBinary)
    token_expiry = Column(DateTime)
    scopes = Column(Text)
    updated_at = Column(DateTime, server_default=func.current_timestamp(), onupdate=func.current_timestamp())

    user = relationship("User", back_populates="google_credential")


class MoodEntry(Base):
    __tablename__ = "mood_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    raw_transcript = Column(Text, nullable=False)
    mood_score = Column(Integer)
    energy_level = Column(Integer)
    anxiety_level = Column(Integer)
    keywords = Column(Text)
    summary = Column(Text)
    agent_response = Column(Text)


class MoodSession(Base):
    __tablename__ = "mood_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    started_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    ended_at = Column(DateTime)
    status = Column(String(16), default="active", nullable=False)  # active | completed
    mood_entry_id = Column(Integer, ForeignKey("mood_entries.id"))

    turns = relationship(
        "ConversationTurn",
        back_populates="session",
        order_by="ConversationTurn.id",
        cascade="all, delete-orphan",
    )


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("mood_sessions.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    role = Column(String(16), nullable=False)  # user | agent
    content = Column(Text, nullable=False)

    session = relationship("MoodSession", back_populates="turns")


class JobMetric(Base):
    __tablename__ = "job_metrics"
    __table_args__ = (UniqueConstraint("user_id", "email_id", name="uq_job_metrics_user_email"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    detected_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    email_id = Column(String(64), index=True)
    company = Column(String(255))
    job_title = Column(String(255))
    status = Column(String(32))
    source = Column(String(64))
    email_subject = Column(Text)
    email_snippet = Column(Text)
    applied_date = Column(Date)
    response_date = Column(Date)
