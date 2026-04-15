import logging
from pathlib import Path

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"


def retrieve_policy_sections(
    facility_id: str,
    service_requested: str,
    denial_reason: str,
    required_documents: list[str],
) -> list[str]:
    """Keyword-based policy section retrieval. No model calls."""
    policy_path = DATA_DIR / "policies" / f"{facility_id}.md"
    if not policy_path.exists():
        logger.warning("policy file not found: %s", policy_path)
        return []

    text = policy_path.read_text(encoding="utf-8")
    sections = _split_sections(text)

    if not sections:
        logger.warning("no sections found in %s", policy_path)
        return []

    keywords = _build_keywords(service_requested, denial_reason, required_documents)
    scored = []
    for section in sections:
        section_lower = section.lower()
        hits = sum(1 for kw in keywords if kw in section_lower)
        if hits > 0:
            scored.append((hits, section))

    scored.sort(key=lambda x: x[0], reverse=True)
    matched = [s for _, s in scored[:3]]

    if not matched:
        logger.info("zero keyword matches in %s, returning first 2 sections", policy_path.name)
        return sections[:2]

    return matched


def _split_sections(text: str) -> list[str]:
    """Split markdown by ## headings into sections."""
    parts = text.split("\n## ")
    sections = []
    for i, part in enumerate(parts):
        content = part.strip()
        if not content:
            continue
        if i > 0:
            content = "## " + content
        sections.append(content)
    return sections


def _build_keywords(
    service_requested: str,
    denial_reason: str,
    required_documents: list[str],
) -> list[str]:
    """Build lowercase keyword list from inputs."""
    keywords = []
    for phrase in [service_requested, denial_reason] + required_documents:
        words = phrase.lower().split()
        keywords.extend(w for w in words if len(w) > 3)
    return list(set(keywords))
