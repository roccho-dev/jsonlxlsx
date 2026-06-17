"""Tests for append-only JSONL reduction with natural key dispatch."""

import pytest

from jsonxlsx.reduce import init_schema, reduce_log, _record_key


def test_reduce_single_record():
    """Single record should pass through unchanged."""
    records = [{"id": "a", "value": "x"}]
    init_schema([{"type": "test", "presence": ["id"], "key": ["id"]}])
    result = reduce_log(records)
    assert len(result) == 1
    assert result[0]["id"] == "a"


def test_reduce_latest_wins_with_timestamp():
    """Latest _ts wins within a natural key group."""
    records = [
        {"id": "a", "value": "x", "_ts": "2026-01-01"},
        {"id": "a", "value": "y", "_ts": "2026-01-02"},
        {"id": "a", "value": "z", "_ts": "2026-01-03"},
    ]
    init_schema([{"type": "test", "presence": ["id"], "key": ["id"]}])
    result = reduce_log(records)
    assert len(result) == 1
    assert result[0]["value"] == "z"


def test_reduce_tombstone_deleted():
    """Record with _deleted: true is excluded from output."""
    records = [
        {"id": "a", "value": "x", "_ts": "2026-01-01"},
        {"id": "a", "value": "y", "_ts": "2026-01-02", "_deleted": True},
    ]
    init_schema([{"type": "test", "presence": ["id"], "key": ["id"]}])
    result = reduce_log(records)
    assert len(result) == 0


def test_reduce_mixed_timestamp_and_no_timestamp():
    """When group has both _ts and non-_ts records, only _ts records are kept."""
    records = [
        {"id": "a", "value": "x"},
        {"id": "a", "value": "y", "_ts": "2026-01-01"},
        {"id": "a", "value": "z", "_ts": "2026-01-02"},
    ]
    init_schema([{"type": "test", "presence": ["id"], "key": ["id"]}])
    result = reduce_log(records)
    assert len(result) == 1
    assert result[0]["value"] == "z"


def test_reduce_natural_key_dispatch():
    """Natural key dispatch driven by schema presence and key fields."""
    records = [
        {"type": "rel-001", "name": "release-a", "_ts": "2026-01-01"},
        {"type": "rel-001", "name": "release-a-updated", "_ts": "2026-01-02"},
    ]
    init_schema([{"type": "release", "presence": ["type", "name"], "key": ["type"]}])
    result = reduce_log(records)
    assert len(result) == 1
    assert result[0]["name"] == "release-a-updated"


def test_reduce_multiple_groups():
    """Multiple natural keys should be tracked independently."""
    records = [
        {"id": "a", "value": "x", "_ts": "2026-01-01"},
        {"id": "b", "value": "y", "_ts": "2026-01-01"},
        {"id": "a", "value": "x-new", "_ts": "2026-01-02"},
    ]
    init_schema([{"type": "test", "presence": ["id"], "key": ["id"]}])
    result = reduce_log(records)
    assert len(result) == 2
    values = {r["id"]: r["value"] for r in result}
    assert values["a"] == "x-new"
    assert values["b"] == "y"


def test_reduce_schema_bootstrap():
    """Schema declarations themselves use fixed natural key."""
    records = [
        {"type": "release", "presence": ["id"], "key": ["id"]},
        {"type": "release", "presence": ["id", "name"], "key": ["id", "name"]},
    ]
    init_schema([])
    result = reduce_log(records)
    assert len(result) == 1
    assert result[0]["key"] == ["id", "name"]


def test_reduce_non_null_constraint():
    """Records with None in non_null fields should not match schema."""
    records = [
        {"id": "a", "name": "test", "_ts": "2026-01-01"},
        {"id": "a", "name": None, "_ts": "2026-01-02"},
    ]
    init_schema([{"type": "item", "presence": ["id", "name"], "key": ["id"], "non_null": ["name"]}])
    result = reduce_log(records)
    assert len(result) == 2


def test_record_key_generic_fallback():
    """Unmatched records should use generic fallback key."""
    init_schema([])
    key = _record_key({"x": 1, "y": 2})
    assert key[0] == "generic"
