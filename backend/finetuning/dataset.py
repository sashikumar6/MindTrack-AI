"""Validation, reporting, and deterministic splitting for fine-tuning data."""
from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path
from typing import Any

REQUIRED_FIELDS = (
    "mood_score",
    "energy_level",
    "anxiety_level",
    "keywords",
    "summary",
)


def load_examples(path: Path) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as fh:
        for line_number, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            try:
                example = json.loads(line)
                validate_example(example)
            except (json.JSONDecodeError, ValueError) as exc:
                raise ValueError(f"{path}:{line_number}: {exc}") from exc
            examples.append(example)
    return examples


def validate_example(example: dict[str, Any]) -> None:
    messages = example.get("messages")
    if not isinstance(messages, list) or len(messages) != 3:
        raise ValueError("expected exactly three messages")
    expected_roles = ["system", "user", "assistant"]
    if [message.get("role") for message in messages] != expected_roles:
        raise ValueError(f"expected roles {expected_roles}")
    if not all(isinstance(message.get("content"), str) for message in messages):
        raise ValueError("every message must contain text content")

    transcript = messages[1]["content"].strip()
    if len(transcript) < 15:
        raise ValueError("user transcript is too short")

    try:
        output = json.loads(messages[2]["content"])
    except json.JSONDecodeError as exc:
        raise ValueError("assistant content is not valid JSON") from exc
    if any(field not in output for field in REQUIRED_FIELDS):
        raise ValueError("assistant output is missing required fields")
    for field in ("mood_score", "energy_level", "anxiety_level"):
        value = output[field]
        if not isinstance(value, int) or not 1 <= value <= 10:
            raise ValueError(f"{field} must be an integer from 1 to 10")
    if not isinstance(output["keywords"], list) or not 2 <= len(output["keywords"]) <= 4:
        raise ValueError("keywords must contain two to four items")
    if not isinstance(output["summary"], str) or len(output["summary"].strip()) < 5:
        raise ValueError("summary is too short")


def transcript(example: dict[str, Any]) -> str:
    return " ".join(example["messages"][1]["content"].lower().split())


def expected_output(example: dict[str, Any]) -> dict[str, Any]:
    return json.loads(example["messages"][2]["content"])


def quality_report(examples: list[dict[str, Any]]) -> dict[str, Any]:
    normalized = [transcript(example) for example in examples]
    duplicates = len(normalized) - len(set(normalized))
    outputs = [expected_output(example) for example in examples]
    score_counts = {
        field: dict(sorted(Counter(output[field] for output in outputs).items()))
        for field in ("mood_score", "energy_level", "anxiety_level")
    }
    return {
        "examples": len(examples),
        "duplicates": duplicates,
        "unique_ratio": round(len(set(normalized)) / max(len(normalized), 1), 3),
        "average_transcript_words": round(
            sum(len(item.split()) for item in normalized) / max(len(normalized), 1), 1
        ),
        "score_distributions": score_counts,
    }


def split_examples(
    examples: list[dict[str, Any]],
    validation_ratio: float = 0.2,
    seed: int = 42,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not 0 < validation_ratio < 1:
        raise ValueError("validation_ratio must be between 0 and 1")
    if len(examples) < 20:
        raise ValueError("at least 20 examples are required for a useful split")
    shuffled = list(examples)
    random.Random(seed).shuffle(shuffled)
    validation_count = max(10, round(len(shuffled) * validation_ratio))
    validation = shuffled[:validation_count]
    training = shuffled[validation_count:]
    if {transcript(item) for item in training} & {
        transcript(item) for item in validation
    }:
        raise ValueError("training and validation transcripts overlap")
    return training, validation


def write_jsonl(path: Path, examples: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for example in examples:
            fh.write(json.dumps(example, ensure_ascii=False) + "\n")
