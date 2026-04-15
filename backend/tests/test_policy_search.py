"""Tests for app.policy_search — keyword-based policy section retrieval."""

from pathlib import Path
from unittest.mock import patch

from app.policy_search import (
    _build_keywords,
    _split_sections,
    retrieve_policy_sections,
)


# ---------- _split_sections ----------

def test_split_sections_basic():
    text = "# Title\nIntro\n\n## A\nBody A\n\n## B\nBody B"
    sections = _split_sections(text)
    assert len(sections) == 3
    assert sections[0] == "# Title\nIntro"
    assert sections[1] == "## A\nBody A"
    assert sections[2] == "## B\nBody B"


def test_split_sections_empty_string():
    assert _split_sections("") == []


def test_split_sections_no_headings():
    text = "just plain text with no headings"
    sections = _split_sections(text)
    assert len(sections) == 1
    assert sections[0] == text


def test_split_sections_only_headings():
    text = "## Alpha\n\n## Beta\n\n## Gamma"
    sections = _split_sections(text)
    assert len(sections) == 3
    assert all(s.startswith("## ") for s in sections)


def test_split_sections_preserves_heading_prefix():
    text = "Preamble\n## First\nContent"
    sections = _split_sections(text)
    assert sections[1].startswith("## First")


# ---------- _build_keywords ----------

def test_build_keywords_filters_short_words():
    keywords = _build_keywords("PT", "not medically necessary", [])
    # "not" (3 chars) and "PT" (2 chars) should be excluded
    assert "not" not in keywords
    assert "pt" not in keywords
    assert "medically" in keywords
    assert "necessary" in keywords


def test_build_keywords_deduplicates():
    keywords = _build_keywords(
        "physical therapy",
        "physical therapy denied",
        ["physical therapy notes"],
    )
    # "physical" appears 3 times but should be deduplicated
    assert keywords.count("physical") == 1
    assert keywords.count("therapy") == 1


def test_build_keywords_includes_required_documents():
    keywords = _build_keywords("PT", "denied", ["progress notes", "physician order"])
    assert "progress" in keywords
    assert "notes" in keywords
    assert "physician" in keywords
    assert "order" in keywords


def test_build_keywords_empty_inputs():
    keywords = _build_keywords("", "", [])
    assert keywords == []


# ---------- retrieve_policy_sections ----------

def test_retrieve_returns_empty_for_missing_facility(tmp_path, monkeypatch):
    monkeypatch.setattr("app.policy_search.DATA_DIR", tmp_path)
    (tmp_path / "policies").mkdir()
    result = retrieve_policy_sections("no-such-facility", "PT", "denied", [])
    assert result == []


def test_retrieve_returns_empty_for_empty_file(tmp_path, monkeypatch):
    monkeypatch.setattr("app.policy_search.DATA_DIR", tmp_path)
    policies = tmp_path / "policies"
    policies.mkdir()
    (policies / "fac-1.md").write_text("")
    result = retrieve_policy_sections("fac-1", "PT", "denied", [])
    assert result == []


def test_retrieve_matches_by_keyword(tmp_path, monkeypatch):
    monkeypatch.setattr("app.policy_search.DATA_DIR", tmp_path)
    policies = tmp_path / "policies"
    policies.mkdir()
    policy_text = (
        "# Policy\nGeneral info\n"
        "## Physical Therapy Coverage\n"
        "PT requires prior auth and physician order.\n"
        "## Pharmacy Benefits\n"
        "Rx copays apply.\n"
        "## Rehabilitation Requirements\n"
        "Rehab requires progress notes within 30 days."
    )
    (policies / "fac-1.md").write_text(policy_text)

    result = retrieve_policy_sections(
        "fac-1", "physical therapy", "not medically necessary",
        ["progress notes"],
    )
    # Should match PT coverage section and rehab section by keyword
    assert len(result) >= 1
    assert any("Physical Therapy" in s for s in result)


def test_retrieve_caps_at_three_sections(tmp_path, monkeypatch):
    monkeypatch.setattr("app.policy_search.DATA_DIR", tmp_path)
    policies = tmp_path / "policies"
    policies.mkdir()
    # Create a policy with 5 sections all containing the keyword "therapy"
    sections = [f"## Section {i}\nTherapy info {i}" for i in range(5)]
    policy_text = "# Policy\nIntro\n" + "\n".join(sections)
    (policies / "fac-1.md").write_text(policy_text)

    result = retrieve_policy_sections("fac-1", "therapy", "therapy denied", [])
    assert len(result) <= 3


def test_retrieve_falls_back_to_first_two_sections(tmp_path, monkeypatch):
    monkeypatch.setattr("app.policy_search.DATA_DIR", tmp_path)
    policies = tmp_path / "policies"
    policies.mkdir()
    policy_text = (
        "# Policy Manual\nVersion 1.0\n"
        "## Eligibility\nMust be enrolled.\n"
        "## Benefits\nStandard plan.\n"
        "## Appeals\nFile within 30 days."
    )
    (policies / "fac-1.md").write_text(policy_text)

    # Use keywords that don't match any section content
    result = retrieve_policy_sections("fac-1", "xyz", "zzz", [])
    assert len(result) == 2
    assert result[0].startswith("# Policy Manual")
    assert result[1].startswith("## Eligibility")


def test_retrieve_ranks_by_hit_count(tmp_path, monkeypatch):
    monkeypatch.setattr("app.policy_search.DATA_DIR", tmp_path)
    policies = tmp_path / "policies"
    policies.mkdir()
    policy_text = (
        "# Policy\nIntro\n"
        "## Section A\nContains physical therapy and physician order requirement.\n"
        "## Section B\nOnly mentions pharmacy.\n"
        "## Section C\nPhysical therapy notes required."
    )
    (policies / "fac-1.md").write_text(policy_text)

    result = retrieve_policy_sections(
        "fac-1", "physical therapy", "physician order", [],
    )
    # Section A has the most hits (physical, therapy, physician, order)
    # It should come first
    assert "Section A" in result[0]
