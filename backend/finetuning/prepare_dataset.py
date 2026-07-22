"""Validate training data and create deterministic train/validation files."""
from __future__ import annotations

import json
from pathlib import Path

from finetuning.dataset import (
    load_examples,
    quality_report,
    split_examples,
    write_jsonl,
)

HERE = Path(__file__).parent
SOURCE = HERE / "training_data.jsonl"
TRAINING_OUTPUT = HERE / "training_split.jsonl"
VALIDATION_OUTPUT = HERE / "validation_data.jsonl"


def main() -> None:
    examples = load_examples(SOURCE)
    training, validation = split_examples(examples)
    write_jsonl(TRAINING_OUTPUT, training)
    write_jsonl(VALIDATION_OUTPUT, validation)
    report = quality_report(examples)
    report.update({"training_examples": len(training), "validation_examples": len(validation)})
    print(json.dumps(report, indent=2))
    print(f"Wrote {TRAINING_OUTPUT}")
    print(f"Wrote {VALIDATION_OUTPUT}")


if __name__ == "__main__":
    main()
