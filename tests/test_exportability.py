"""Verify no forbidden/confidential identifiers appear in repo text."""

import subprocess
import pytest
from pathlib import Path


def _load_denylist() -> list:
    """Load forbidden patterns from external denylist file."""
    denylist_path = Path(__file__).parent.parent / "scripts" / "denylist.txt"

    if not denylist_path.exists():
        return []

    patterns = []
    with open(denylist_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                patterns.append(line)
    return patterns


FORBIDDEN_PATTERNS = _load_denylist()

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
    """Scan repo for forbidden identifiers from external denylist."""
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
