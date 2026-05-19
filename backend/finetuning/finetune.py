"""Upload training_data.jsonl, run an OpenAI fine-tune, write the model id back to .env."""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from openai import AsyncOpenAI

from config.settings import settings

logger = logging.getLogger(__name__)

TRAINING_FILE = Path(__file__).parent / "training_data.jsonl"
BASE_MODEL = "gpt-4o-mini-2024-07-18"
POLL_INTERVAL_SECONDS = 30
MIN_EXAMPLES = 10
TERMINAL_FAIL = {"failed", "cancelled"}


def _line_count(path: Path) -> int:
    with path.open() as fh:
        return sum(1 for line in fh if line.strip())


def _env_candidates() -> list[Path]:
    here = Path(__file__).resolve()
    return [
        here.parents[2] / ".env",
        Path("/app/.env"),
        here.parents[1] / ".env",
    ]


def _write_to_env(model_id: str) -> Path:
    """Upsert OPENAI_FINETUNED_MODEL=<model_id> into the first usable .env file."""
    target = next((p for p in _env_candidates() if p.exists()), _env_candidates()[0])
    target.parent.mkdir(parents=True, exist_ok=True)

    lines = target.read_text().splitlines() if target.exists() else []
    found = False
    for i, line in enumerate(lines):
        if line.startswith("OPENAI_FINETUNED_MODEL="):
            lines[i] = f"OPENAI_FINETUNED_MODEL={model_id}"
            found = True
            break
    if not found:
        lines.append(f"OPENAI_FINETUNED_MODEL={model_id}")

    target.write_text("\n".join(lines).rstrip("\n") + "\n")
    return target


async def run_finetune() -> str:
    if not TRAINING_FILE.exists():
        raise FileNotFoundError(
            f"{TRAINING_FILE} not found. Run generate_training_data.py first."
        )
    count = _line_count(TRAINING_FILE)
    if count < MIN_EXAMPLES:
        raise ValueError(
            f"Need at least {MIN_EXAMPLES} examples, found {count}. "
            "Re-run generate_training_data.py."
        )

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    print(f"Uploading {TRAINING_FILE.name} ({count} examples)…")
    with TRAINING_FILE.open("rb") as fh:
        file_obj = await client.files.create(file=fh, purpose="fine-tune")
    print(f"  → file id: {file_obj.id}")

    print(f"Creating fine-tune job on {BASE_MODEL}…")
    job = await client.fine_tuning.jobs.create(
        training_file=file_obj.id, model=BASE_MODEL
    )
    job_id = job.id
    print(f"  → job id: {job_id}")
    print("Polling every 30s. This usually takes ~20 minutes.\n")

    started = time.time()
    while True:
        job = await client.fine_tuning.jobs.retrieve(job_id)
        elapsed = int(time.time() - started)
        print(f"  [{elapsed:4d}s] status={job.status}")
        if job.status == "succeeded":
            break
        if job.status in TERMINAL_FAIL:
            raise RuntimeError(f"Fine-tune {job.status}: {getattr(job, 'error', None)}")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)

    model_id = job.fine_tuned_model
    if not model_id:
        raise RuntimeError("Fine-tune succeeded but no model id returned")

    env_path = _write_to_env(model_id)
    print(f"\n✓ Fine-tuned model: {model_id}")
    print(f"  Wrote OPENAI_FINETUNED_MODEL → {env_path}")
    print("  Restart the backend (docker compose restart backend) to pick it up.")
    return model_id


if __name__ == "__main__":
    print(asyncio.run(run_finetune()))
