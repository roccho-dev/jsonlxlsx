"""Tests for template-based XLSX rendering."""

from unittest.mock import MagicMock

import pytest

from jsonxlsx.render import coerce, render_value


def test_coerce_iso_date():
    """ISO date string should coerce to datetime.date."""
    result = coerce("2026-01-15")
    assert result.year == 2026
    assert result.month == 1
    assert result.day == 15


def test_coerce_iso_time():
    """ISO time string should coerce to datetime.time."""
    result = coerce("14:30:45")
    assert result.hour == 14
    assert result.minute == 30
    assert result.second == 45


def test_coerce_non_string():
    """Non-string values should pass through unchanged."""
    assert coerce(123) == 123
    assert coerce(1.5) == 1.5
    assert coerce(None) is None


def test_render_value_literal():
    """literal directive should return constant value."""
    directive = {"literal": "constant-value"}
    record = {}
    value = render_value(directive, record, 1)
    assert value == "constant-value"


def test_render_value_formula():
    """formula directive should substitute {r} with row_num."""
    directive = {"formula": "=A{r}+B{r}"}
    record = {}
    value = render_value(directive, record, 5)
    assert value == "=A5+B5"


def test_render_value_src():
    """src directive should return field from record."""
    directive = {"src": "name"}
    record = {"name": "test-item"}
    value = render_value(directive, record, 1)
    assert value == "test-item"


def test_render_value_src_with_coerce():
    """src directive should coerce date strings."""
    directive = {"src": "date_field"}
    record = {"date_field": "2026-06-18"}
    value = render_value(directive, record, 1)
    assert value.year == 2026


def test_render_value_src_list_join():
    """src directive with list should join items."""
    directive = {"src": "items", "join": ", "}
    record = {"items": ["a", "b", "c"]}
    value = render_value(directive, record, 1)
    assert value == "a, b, c"


def test_render_value_src_list_template():
    """src directive with list and item_template should format each item."""
    directive = {"src": "items", "item_template": "({n}) {x}"}
    record = {"items": ["alpha", "beta"]}
    value = render_value(directive, record, 1)
    assert "(1) alpha\n(2) beta" in value


def test_render_value_src_missing():
    """src directive with missing field should return None."""
    directive = {"src": "missing"}
    record = {"name": "test"}
    value = render_value(directive, record, 1)
    assert value is None


def test_render_value_edge_lookup_no_edges():
    """edge_lookup directive should return None (requires separate pass)."""
    directive = {"edge_lookup": {"source": "edges", "match": {}, "select": "target"}}
    record = {}
    value = render_value(directive, record, 1)
    assert value is None
