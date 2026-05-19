from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from db.database import Base


class MoodEntry(Base):
    __tablename__ = "mood_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    raw_transcript = Column(Text, nullable=False)
    mood_score = Column(Integer)
    energy_level = Column(Integer)
    anxiety_level = Column(Integer)
    keywords = Column(Text)
    summary = Column(Text)
    agent_response = Column(Text)


class JobMetric(Base):
    __tablename__ = "job_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    detected_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    email_id = Column(String(64), unique=True, index=True)
    company = Column(String(255))
    job_title = Column(String(255))
    status = Column(String(32))
    source = Column(String(64))
    email_subject = Column(Text)
    email_snippet = Column(Text)
    applied_date = Column(Date)
    response_date = Column(Date)
