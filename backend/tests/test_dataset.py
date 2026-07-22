from pathlib import Path

from finetuning.dataset import load_examples, quality_report, split_examples

DATA = Path(__file__).parents[1] / "finetuning" / "training_data.jsonl"


def test_training_dataset_is_valid_and_unique():
    examples = load_examples(DATA)
    report = quality_report(examples)
    assert report["examples"] >= 100
    assert report["duplicates"] == 0
    assert report["unique_ratio"] == 1.0
    assert report["average_transcript_words"] >= 20


def test_split_is_deterministic_and_has_no_overlap():
    examples = load_examples(DATA)
    train_a, validation_a = split_examples(examples, seed=42)
    train_b, validation_b = split_examples(examples, seed=42)
    assert train_a == train_b
    assert validation_a == validation_b
    assert len(train_a) + len(validation_a) == len(examples)
    assert len(validation_a) == round(len(examples) * 0.2)
    train_text = {item["messages"][1]["content"] for item in train_a}
    validation_text = {item["messages"][1]["content"] for item in validation_a}
    assert train_text.isdisjoint(validation_text)
