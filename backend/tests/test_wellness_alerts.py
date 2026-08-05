from agents.wellness_alerts import assess_wellness_pattern


def test_high_anxiety_creates_a_non_clinical_pattern_notice():
    alert = assess_wellness_pattern([{"mood": 6, "energy": 5, "anxiety": 8}])

    assert alert["active"] is True
    assert alert["kind"] == "high_anxiety"
    assert "clinical" not in alert["message"].lower()


def test_three_declining_checkins_create_a_pattern_notice():
    alert = assess_wellness_pattern(
        [
            {"mood": 7, "energy": 7, "anxiety": 3},
            {"mood": 5, "energy": 5, "anxiety": 5},
            {"mood": 3, "energy": 3, "anxiety": 7},
        ]
    )

    assert alert["active"] is True
    assert alert["kind"] == "sustained_change"
    assert alert["data_points"] == 3


def test_steady_checkins_do_not_create_a_notice():
    alert = assess_wellness_pattern(
        [
            {"mood": 6, "energy": 6, "anxiety": 4},
            {"mood": 6, "energy": 5, "anxiety": 4},
            {"mood": 6, "energy": 6, "anxiety": 4},
        ]
    )

    assert alert == {"active": False}
