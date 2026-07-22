"""Compare mood-extraction models against held-out labeled examples."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from agents.mood_agent import EXTRACTOR_SYSTEM_PROMPT
from config.settings import settings
from finetuning.dataset import expected_output, load_examples

DEFAULT_EVAL_FILE = Path(__file__).parent / "validation_data.jsonl"
SCORE_FIELDS = ("mood_score", "energy_level", "anxiety_level")


async def predict(client: AsyncOpenAI, model: str, text: str) -> dict[str, Any] | None:
    try:
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            temperature=0,
            messages=[
                {"role": "system", "content": EXTRACTOR_SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
        )
        return json.loads(response.choices[0].message.content or "{}")
    except Exception:
        return None


async def evaluate(model: str, examples: list[dict[str, Any]]) -> dict[str, Any]:
    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS,
        max_retries=2,
    )
    semaphore = asyncio.Semaphore(3)

    async def run_one(example: dict[str, Any]):
        async with semaphore:
            return await predict(client, model, example["messages"][1]["content"])

    predictions = await asyncio.gather(*(run_one(example) for example in examples))
    valid = 0
    absolute_error = {field: 0.0 for field in SCORE_FIELDS}
    within_one = 0
    compared_scores = 0

    for example, prediction in zip(examples, predictions):
        if not isinstance(prediction, dict):
            continue
        if not all(field in prediction for field in (*SCORE_FIELDS, "keywords", "summary")):
            continue
        valid += 1
        expected = expected_output(example)
        for field in SCORE_FIELDS:
            try:
                error = abs(float(prediction[field]) - float(expected[field]))
            except (TypeError, ValueError):
                continue
            absolute_error[field] += error
            within_one += int(error <= 1)
            compared_scores += 1

    total = len(examples)
    return {
        "model": model,
        "examples": total,
        "valid_schema_rate": round(valid / max(total, 1), 3),
        "mae": {
            field: round(absolute_error[field] / max(valid, 1), 3)
            for field in SCORE_FIELDS
        },
        "scores_within_one_rate": round(within_one / max(compared_scores, 1), 3),
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+", help="Base and/or fine-tuned model IDs")
    parser.add_argument("--eval-file", type=Path, default=DEFAULT_EVAL_FILE)
    args = parser.parse_args()
    examples = load_examples(args.eval_file)
    reports = [await evaluate(model, examples) for model in args.models]
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
