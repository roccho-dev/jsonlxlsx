"""Append-only JSONL reduction with natural key dispatch and tombstone semantics."""

import json
from typing import Any

_SCHEMA_TYPES: list[dict] = []


def init_schema(types: list[dict]) -> None:
    """Inject natural key declarations loaded from config/schema.jsonl."""
    global _SCHEMA_TYPES
    _SCHEMA_TYPES = types


def _record_key(r: dict) -> tuple[str, ...]:
    """
    Natural key for append-only reduce, driven by config/schema.jsonl.

    Bootstrap cases:
    - Schema declarations (type, presence, key fields) → key is ("schema_type", type)
    - Rule records with _id → key is ("schema_rule", _id)

    Schema-driven dispatch:
    - For each schema spec in _SCHEMA_TYPES, check presence and non_null constraints
    - Return (type, *key_values)

    Fallback:
    - Generic key from sorted non-metadata fields
    """
    if all(k in r for k in ("type", "presence", "key")):
        return ("schema_type", r["type"])
    if "rule" in r and "_id" in r:
        return ("schema_rule", r["_id"])

    for spec in _SCHEMA_TYPES:
        if not all(f in r for f in spec["presence"]):
            continue
        if any(r.get(f) is None for f in spec.get("non_null", [])):
            continue
        return (spec["type"], *(r.get(k) for k in spec["key"]))

    meta = {"_ts", "_deleted", "_op"}
    items = []
    for k, v in r.items():
        if k in meta:
            continue
        if isinstance(v, (dict, list)):
            v = json.dumps(v, sort_keys=True, ensure_ascii=False)
        items.append((k, v))
    return ("generic", tuple(sorted(items)))


def reduce_log(records: list[dict]) -> list[dict]:
    """
    Per-key append-only reduce.

    For each natural key group:
    1. If any record has _ts, keep only _ts records (exclude records without timestamp)
    2. Among _ts records, latest _ts wins
    3. If winner has _deleted: true, exclude it from output
    """
    groups: dict[tuple[str, ...], list[dict]] = {}
    order: list[tuple[str, ...]] = []

    for r in records:
        k = _record_key(r)
        if k not in groups:
            groups[k] = []
            order.append(k)
        groups[k].append(r)

    result = []
    for k in order:
        group = groups[k]

        if any(r.get("_ts") for r in group):
            group = [r for r in group if r.get("_ts")]

        winner = group[0]
        for r in group:
            if r.get("_ts", "") >= winner.get("_ts", ""):
                winner = r

        if not winner.get("_deleted"):
            result.append(winner)

    return result
