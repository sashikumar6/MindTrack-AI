"""Generate 100 synthetic mood-extraction training examples via GPT-4o."""
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
TARGET_EXAMPLES = 100
CONCURRENCY = 5
RETRIES_PER_SLOT = 2
GENERATOR_MODEL = "gpt-4o"

SCENARIOS: list[str] = [
    "good day - rested, productive, things clicking into place",
    "bad day - low mood, dragging through tasks, hard to start",
    "anxious day - racing thoughts, worried about something specific",
    "burnt out - exhausted, overwhelmed, considering taking a break",
    "hopeful day - cautiously optimistic, momentum building",
    "interview day - nervous excitement, prep mode, jittery",
    "post-rejection - disappointed but processing, mixed feelings",
    "neutral day - nothing special, routine, just going through motions",
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

The extraction MUST accurately reflect the transcript:
- mood_score, energy_level, anxiety_level: integers 1-10
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
                return {"transcript": transcript, "extraction": extraction}
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


if __name__ == "__main__":
    asyncio.run(generate())
