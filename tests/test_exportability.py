"""Verify no forbidden/confidential identifiers appear in repo text."""

import subprocess
from pathlib import Path


# Load forbidden patterns from external denylist
FORBIDDEN_PATTERNS = [
    r"\bgenai-toyhobby\b",
    r"\bchatbot\b",
    r"\bDify\b",
    r"\bchatte\b",
    r"\bbandai\b",
    r"\bnamco\b",
    r"\bbnx\b",
    r"\bz-s\b",
    r"\bdiv-",
    r"\.jp\b",
    r"\bt8-\w+\b",
    r"\b(azure|gcp|vertex|cloud-run)\b",
]

# Files/dirs to exclude from scan
EXCLUDE_PATHS = {
    ".git",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    "dist",
    "build",
    "*.egg-info",
}


def _normalize_path(p: Path) -> str:
    """Get relative path for display."""
    try:
        return str(p.relative_to(Path(__file__).parent.parent))
    except ValueError:
        return str(p)


def test_no_forbidden_patterns():
    """Scan repo for forbidden identifiers and customer-specific terms."""
    repo_root = Path(__file__).parent.parent
    found_violations = []

    for file_path in repo_root.rglob("*"):
        if file_path.is_dir():
            continue

        relative = file_path.relative_to(repo_root)
        if any(part in EXCLUDE_PATHS for part in relative.parts):
            continue

        if file_path.suffix in {".pyc", ".xlsx", ".bin"}:
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except (OSError, IsADirectoryError):
            continue

        for pattern in FORBIDDEN_PATTERNS:
            matches = subprocess.run(
                ["grep", "-n", "-i", pattern, str(file_path)],
                capture_output=True,
                text=True,
            )
            if matches.returncode == 0:
                for line in matches.stdout.strip().split("\n"):
                    if line:
                        found_violations.append(f"{_normalize_path(file_path)}: {line}")

    assert not found_violations, (
        f"Found {len(found_violations)} forbidden pattern(s):\n"
        + "\n".join(found_violations[:10])
    )


def test_synthetic_names_used():
    """Verify examples use synthetic names (release-*, service-*, check-*, etc)."""
    examples_dir = Path(__file__).parent.parent / "examples"

    if not examples_dir.exists():
        pytest.skip("examples/ directory not found")

    found_synthetic = False
    for jsonl_file in examples_dir.rglob("*.jsonl"):
        content = jsonl_file.read_text()
        if any(name in content for name in ["release-", "service-", "check-", "team-"]):
            found_synthetic = True
            break

    assert found_synthetic, "No synthetic names found in examples/"


if __name__ == "__main__":
    test_no_forbidden_patterns()
    test_synthetic_names_used()
    print("✓ Exportability checks passed")
