"""Tests for app.event_store — JSONL append-only event log."""

import json

from app.event_store import append_event, read_events, run_exists


def test_append_creates_file(tmp_runs):
    append_event("run-1", "run_started", {"case_id": "case-001"})
    assert (tmp_runs / "run-1.jsonl").exists()


def test_append_writes_valid_jsonl(tmp_runs):
    append_event("run-1", "run_started", {"case_id": "case-001"})
    line = (tmp_runs / "run-1.jsonl").read_text().strip()
    event = json.loads(line)
    assert event["type"] == "run_started"
    assert event["payload"]["case_id"] == "case-001"
    assert "timestamp" in event


def test_read_returns_events_in_order(tmp_runs):
    append_event("run-1", "run_started", {})
    append_event("run-1", "documents_loaded", {})
    append_event("run-1", "facts_extracted", {})
    events = read_events("run-1")
    assert len(events) == 3
    assert [e["type"] for e in events] == [
        "run_started",
        "documents_loaded",
        "facts_extracted",
    ]


def test_read_empty_for_missing_run(tmp_runs):
    assert read_events("nonexistent") == []


def test_read_skips_blank_lines(tmp_runs):
    path = tmp_runs / "run-1.jsonl"
    path.write_text(
        '{"type":"a","timestamp":"t","payload":{}}\n'
        "\n"
        '{"type":"b","timestamp":"t","payload":{}}\n'
    )
    events = read_events("run-1")
    assert len(events) == 2


def test_read_skips_malformed_lines(tmp_runs):
    path = tmp_runs / "run-1.jsonl"
    path.write_text(
        '{"type":"a","timestamp":"t","payload":{}}\n'
        "not valid json\n"
        '{"type":"b","timestamp":"t","payload":{}}\n'
    )
    events = read_events("run-1")
    assert len(events) == 2
    assert events[0]["type"] == "a"
    assert events[1]["type"] == "b"


def test_run_exists_true(tmp_runs):
    append_event("run-1", "run_started", {})
    assert run_exists("run-1") is True


def test_run_exists_false(tmp_runs):
    assert run_exists("nonexistent") is False


def test_multiple_runs_isolated(tmp_runs):
    append_event("run-a", "run_started", {})
    append_event("run-b", "run_started", {})
    assert len(read_events("run-a")) == 1
    assert len(read_events("run-b")) == 1
