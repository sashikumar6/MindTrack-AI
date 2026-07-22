"""Generate a balanced synthetic mood-extraction dataset via a teacher model."""
from __future__ import annotations

import asyncio
import json
import logging
import random
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from agents.mood_agent import EXTRACTOR_SYSTEM_PROMPT
from config.settings import settings

logger = logging.getLogger(__name__)

OUTPUT_PATH = Path(__file__).parent / "training_data.jsonl"
RAW_OUTPUT_PATH = Path(__file__).parent / "generated_examples.jsonl"
TARGET_EXAMPLES = 140
CONCURRENCY = 5
RETRIES_PER_SLOT = 2
GENERATOR_MODEL = "gpt-4o"

SCENARIOS: list[str] = [
    "excellent day; target mood 9-10, energy 8-10, anxiety 1-3",
    "good productive day; target mood 7-9, energy 7-9, anxiety 1-4",
    "neutral routine day; target mood 4-6, energy 4-6, anxiety 3-5",
    "very low non-crisis day; target mood 1-2, energy 1-3, anxiety 4-8",
    "bad low-motivation day; target mood 2-4, energy 2-4, anxiety 3-7",
    "burnout and overload; target mood 2-4, energy 1-3, anxiety 6-9",
    "calm restorative day; target mood 6-8, energy 3-6, anxiety 1-2",
    "panic-level but non-crisis anxiety; target mood 2-5, energy 3-8, anxiety 9-10",
    "hopeful recovery day; target mood 6-8, energy 5-8, anxiety 3-6",
    "interview nerves and excitement; target mood 5-8, energy 6-9, anxiety 6-9",
    "post-rejection mixed feelings; target mood 3-5, energy 3-6, anxiety 4-7",
    "mixed high-energy bad mood; target mood 2-4, energy 7-9, anxiety 6-9",
    "mixed low-energy good mood; target mood 7-9, energy 1-3, anxiety 1-4",
    "ambiguous short check-in requiring conservative scores near 4-6",
]

GENERATOR_SYSTEM_PROMPT = """You are creating synthetic training data for a mental health voice check-in extractor.

Generate ONE realistic example for the given scenario.

The transcript MUST:
- sound like raw Whisper output from a 30-second voice memo
- be casual, lowercase, NO polished punctuation
- include filler words ("um", "like", "i mean", "you know", "honestly")
- contain run-on sentences and incomplete thoughts
- be 1-4 sentences total
- reference believable details (work, applications, sleep, friends, food, exercise, weather)
- vary in topic — don't always mention applications
- never include suicidal, self-harm, or immediate-danger language; that is handled by a separate safety layer

The extraction MUST accurately reflect the transcript:
- mood_score, energy_level, anxiety_level: integers 1-10
- follow the target score ranges in the scenario unless the transcript clearly supports a nearby value
- use the full scale: 1 is extreme low/calm/exhausted, 5 is ordinary/neutral, 10 is exceptional/intense
- keywords: 2-4 short phrases pulled from or paraphrasing the transcript
- summary: one short sentence

Return JSON only, no preamble:
{
  "transcript": "...",
  "extraction": {
    "mood_score": <int 1-10>,
    "energy_level": <int 1-10>,
    "anxiety_level": <int 1-10>,
    "keywords": ["...", "..."],
    "summary": "..."
  }
}"""


def _build_scenario_queue() -> list[str]:
    queue: list[str] = []
    base = TARGET_EXAMPLES // len(SCENARIOS)
    extra = TARGET_EXAMPLES - base * len(SCENARIOS)
    for i, scenario in enumerate(SCENARIOS):
        count = base + (1 if i < extra else 0)
        queue.extend([scenario] * count)
    random.shuffle(queue)
    return queue


def _valid_extraction(transcript: str, extraction: Any) -> bool:
    if not isinstance(transcript, str) or len(transcript.strip()) < 15:
        return False
    if not isinstance(extraction, dict):
        return False
    for key in ("mood_score", "energy_level", "anxiety_level"):
        v = extraction.get(key)
        if not isinstance(v, int) or not 1 <= v <= 10:
            return False
    keywords = extraction.get("keywords")
    if not isinstance(keywords, list) or not keywords:
        return False
    if not all(isinstance(k, str) and k.strip() for k in keywords):
        return False
    summary = extraction.get("summary")
    if not isinstance(summary, str) or len(summary.strip()) < 5:
        return False
    return True


async def _generate_one(client: AsyncOpenAI, scenario: str) -> dict[str, Any] | None:
    for attempt in range(RETRIES_PER_SLOT + 1):
        try:
            resp = await client.chat.completions.create(
                model=GENERATOR_MODEL,
                response_format={"type": "json_object"},
                temperature=1.0,
                messages=[
                    {"role": "system", "content": GENERATOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Scenario: {scenario}"},
                ],
            )
            data = json.loads(resp.choices[0].message.content or "{}")
            transcript = (data.get("transcript") or "").strip()
            extraction = data.get("extraction")
            if _valid_extraction(transcript, extraction):
                return {
                    "scenario": scenario,
                    "transcript": transcript,
                    "extraction": extraction,
                }
        except Exception as exc:
            logger.warning("generation attempt %d failed (%s): %s", attempt + 1, scenario[:40], exc)
            await asyncio.sleep(0.5 * (attempt + 1))
    return None


async def generate() -> None:
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    semaphore = asyncio.Semaphore(CONCURRENCY)
    results: list[dict[str, Any]] = []
    queue = _build_scenario_queue()
    print(f"Generating {TARGET_EXAMPLES} examples across {len(SCENARIOS)} scenarios "
          f"(concurrency={CONCURRENCY})…")

    async def worker(scenario: str) -> None:
        async with semaphore:
            example = await _generate_one(client, scenario)
            if example and len(results) < TARGET_EXAMPLES:
                results.append(example)
                print(f"  [{len(results):3d}/{TARGET_EXAMPLES}] ✓ {scenario[:50]}")

    while len(results) < TARGET_EXAMPLES:
        if not queue:
            queue = [random.choice(SCENARIOS) for _ in range(TARGET_EXAMPLES - len(results))]
        batch_count = min(len(queue), TARGET_EXAMPLES - len(results))
        batch = [queue.pop() for _ in range(batch_count)]
        await asyncio.gather(*(worker(s) for s in batch))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RAW_OUTPUT_PATH.open("w") as fh:
        for example in results[:TARGET_EXAMPLES]:
            fh.write(json.dumps(example, ensure_ascii=False) + "\n")
    with OUTPUT_PATH.open("w") as fh:
        for example in results[:TARGET_EXAMPLES]:
            line = {
                "messages": [
                    {"role": "system", "content": EXTRACTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": example["transcript"]},
                    {"role": "assistant", "content": json.dumps(example["extraction"], ensure_ascii=False)},
                ]
            }
            fh.write(json.dumps(line, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(results[:TARGET_EXAMPLES])} examples → {OUTPUT_PATH}")
    print(f"Wrote labeled generation metadata → {RAW_OUTPUT_PATH}")


if __name__ == "__main__":
    asyncio.run(generate())
