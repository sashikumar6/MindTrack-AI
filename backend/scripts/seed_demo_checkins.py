"""Create repeatable local-only demo check-ins for a chosen user.

Run from the backend container:
    PYTHONPATH=/app python scripts/seed_demo_checkins.py --user-id 4

The script removes only entries that it previously created (marked with the
``demo_seed`` keyword). It never removes real user check-ins.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from sqlalchemy import select

from db.database import get_session
from db.models import ConversationTurn, MoodEntry, MoodSession, User


DEMO_KEYWORD = "demo_seed"
DEMO_DAYS = [
    {
        "mood": 8,
        "energy": 7,
        "anxiety": 2,
        "summary": "Felt optimistic after making progress on an important project.",
        "transcript": "I made real progress today and felt more confident about where things are going.",
    },
    {
        "mood": 7,
        "energy": 7,
        "anxiety": 3,
        "summary": "Had a productive day with manageable interview nerves.",
        "transcript": "I was productive today. I still felt some nerves about interviews, but they did not take over the day.",
    },
    {
        "mood": 7,
        "energy": 6,
        "anxiety": 3,
        "summary": "Maintained a steady routine and completed planned work.",
        "transcript": "Today was steady. I got through my plan and made time to rest afterward.",
    },
    {
        "mood": 6,
        "energy": 6,
        "anxiety": 4,
        "summary": "Felt some pressure from deadlines but stayed grounded.",
        "transcript": "The deadlines felt closer today, so I was a little tense, but I handled the important tasks.",
    },
    {
        "mood": 5,
        "energy": 5,
        "anxiety": 5,
        "summary": "Energy dipped as the workload started to feel heavier.",
        "transcript": "I got things done, but it took more effort than usual and I could feel the workload building up.",
    },
    {
        "mood": 4,
        "energy": 4,
        "anxiety": 6,
        "summary": "Felt drained and worried about several competing priorities.",
        "transcript": "I feel drained today. There are several priorities competing for attention and I am worried about keeping up.",
    },
    {
        "mood": 3,
        "energy": 3,
        "anxiety": 7,
        "summary": "The week has felt heavier, with low energy and increased worry.",
        "transcript": "This week has started to feel heavy. My energy is low and I keep thinking about everything I still need to do.",
    },
]


def remove_previous_demo_data(user_id: int) -> int:
    with get_session() as session:
        entries = (
            session.execute(
                select(MoodEntry)
                .where(MoodEntry.user_id == user_id, MoodEntry.keywords == DEMO_KEYWORD)
            )
            .scalars()
            .all()
        )
        for entry in entries:
            sessions = (
                session.execute(
                    select(MoodSession).where(MoodSession.mood_entry_id == entry.id)
                )
                .scalars()
                .all()
            )
            for mood_session in sessions:
                for turn in list(mood_session.turns):
                    session.delete(turn)
                session.delete(mood_session)
        # MoodSession has a foreign key to MoodEntry. Flush those dependent
        # deletes before deleting the demo entries themselves.
        session.flush()
        for entry in entries:
            session.delete(entry)
        return len(entries)


def seed_checkins(user_id: int) -> int:
    with get_session() as session:
        user = session.get(User, user_id)
        if user is None:
            raise ValueError(f"No user found with id {user_id}")

        # Finish the synthetic sequence just before the script runs. This
        # keeps it newer than any earlier local testing entries on the same
        # calendar day, without ever writing a future-dated check-in.
        latest_checkin_at = datetime.utcnow().replace(second=0, microsecond=0) - timedelta(minutes=2)
        for offset, data in enumerate(DEMO_DAYS):
            created_at = latest_checkin_at - timedelta(days=len(DEMO_DAYS) - 1 - offset)
            entry = MoodEntry(
                user_id=user_id,
                created_at=created_at,
                raw_transcript=data["transcript"],
                mood_score=data["mood"],
                energy_level=data["energy"],
                anxiety_level=data["anxiety"],
                keywords=DEMO_KEYWORD,
                summary=data["summary"],
                agent_response="Thanks for checking in. I’m noticing the pattern with you.",
            )
            session.add(entry)
            session.flush()
            mood_session = MoodSession(
                user_id=user_id,
                started_at=created_at,
                ended_at=created_at + timedelta(minutes=3),
                status="completed",
                mood_entry_id=entry.id,
            )
            session.add(mood_session)
            session.flush()
            session.add_all(
                [
                    ConversationTurn(
                        session_id=mood_session.id,
                        role="user",
                        content=data["transcript"],
                    ),
                    ConversationTurn(
                        session_id=mood_session.id,
                        role="agent",
                        content=entry.agent_response,
                    ),
                ]
            )
        return len(DEMO_DAYS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", type=int, required=True)
    args = parser.parse_args()

    removed = remove_previous_demo_data(args.user_id)
    created = seed_checkins(args.user_id)
    print(f"Removed {removed} previous demo entries; created {created} demo check-ins.")


if __name__ == "__main__":
    main()
