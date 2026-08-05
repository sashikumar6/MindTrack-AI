"""Deterministic, non-clinical wellness-pattern notices.

These notices are intentionally separate from crisis detection. A score trend
can invite a supportive check-in, but cannot determine that somebody is in
immediate danger.
"""
from __future__ import annotations

from typing import Any


def assess_wellness_pattern(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Return one explainable pattern notice for chronological check-ins.

    The caller provides oldest-to-newest complete score records. The priority
    order favors a current high-anxiety or very-low mood/energy signal, then a
    three-check-in sustained decline. Positive mood or high energy alone never
    generates an alert.
    """
    complete = [
        entry
        for entry in entries
        if all(entry.get(field) is not None for field in ("mood", "energy", "anxiety"))
    ]
    if not complete:
        return {"active": False}

    latest = complete[-1]
    if latest["anxiety"] >= 8:
        return {
            "active": True,
            "kind": "high_anxiety",
            "title": "A little extra support could help today",
            "message": "Your latest check-in reflects high anxiety. A short conversation may help you name what feels most pressing.",
            "reason": "Anxiety was 8 or higher in the latest completed check-in.",
            "data_points": 1,
        }
    if latest["mood"] <= 2 or latest["energy"] <= 2:
        dimension = "mood" if latest["mood"] <= 2 else "energy"
        return {
            "active": True,
            "kind": f"low_{dimension}",
            "title": "A little extra support could help today",
            "message": f"Your latest check-in reflects very low {dimension}. Consider taking a moment to talk through what is weighing on you.",
            "reason": f"{dimension.capitalize()} was 2 or lower in the latest completed check-in.",
            "data_points": 1,
        }

    if len(complete) < 3:
        return {"active": False}

    recent = complete[-3:]
    mood_decline = (
        recent[0]["mood"] >= recent[1]["mood"] >= recent[2]["mood"]
        and recent[0]["mood"] - recent[2]["mood"] >= 2
    )
    energy_decline = (
        recent[0]["energy"] >= recent[1]["energy"] >= recent[2]["energy"]
        and recent[0]["energy"] - recent[2]["energy"] >= 2
    )
    anxiety_rise = (
        recent[0]["anxiety"] <= recent[1]["anxiety"] <= recent[2]["anxiety"]
        and recent[2]["anxiety"] - recent[0]["anxiety"] >= 2
    )
    if mood_decline or energy_decline or anxiety_rise:
        changing = []
        if mood_decline:
            changing.append("mood")
        if energy_decline:
            changing.append("energy")
        if anxiety_rise:
            changing.append("anxiety")
        return {
            "active": True,
            "kind": "sustained_change",
            "title": "Your recent pattern deserves a check-in",
            "message": "Your last three completed check-ins show a sustained change. Talking it out can help you reflect on what has been building.",
            "reason": f"Sustained change in {', '.join(changing)} across the last three completed check-ins.",
            "data_points": 3,
        }

    return {"active": False}
