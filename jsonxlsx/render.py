"""Template-based XLSX rendering with config-driven sheet strategies."""

import re
from copy import copy
from datetime import datetime, time, date as _date
from typing import Any

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME = re.compile(r"^\d{2}:\d{2}:\d{2}$")


def coerce(v: Any) -> Any:
    """Coerce string values to date/time if they match ISO patterns."""
    if isinstance(v, str):
        if _DATE.match(v):
            return datetime.fromisoformat(v)
        if _TIME.match(v):
            return time.fromisoformat(v)
    return v


def copy_style(target: Any, template: Any) -> None:
    """Copy openpyxl cell styling from template to target cell."""
    target.font = copy(template.font)
    target.fill = copy(template.fill)
    target.border = copy(template.border)
    target.alignment = copy(template.alignment)
    target.number_format = template.number_format
    target.protection = copy(template.protection)


def render_value(
    directive: dict[str, Any], record: dict[str, Any], row_num: int, edges: dict[str, list[dict]] | None = None
) -> Any:
    """
    Apply a column directive to derive a cell value.

    Directives:
    - literal: constant value
    - formula: cell formula with {r} → row_num substitution
    - src: source field from record, optionally joined/templated
    - edge_lookup: join with edges (requires separate pass with edges context)
    """
    if "literal" in directive:
        return directive["literal"]

    if "formula" in directive:
        return directive["formula"].replace("{r}", str(row_num))

    if "edge_lookup" in directive:
        return None

    if "src" in directive:
        v = record.get(directive["src"])
        if v is None:
            return None
        if isinstance(v, list):
            sep = directive.get("join", "\n")
            tmpl = directive.get("item_template", "{x}")
            return sep.join(tmpl.format(n=i + 1, x=str(x)) for i, x in enumerate(v))
        return coerce(v)

    return None


def render_sheet_data_replace(
    ws: Any,
    sheet_cfg: dict[str, Any],
    masters: dict[str, list[dict]],
    edges: dict[str, list[dict]],
) -> None:
    """
    data_replace strategy: clear template data and inject from masters.

    Steps:
    1. Capture style template row
    2. Clear existing data rows (keep structure and styles)
    3. Inject master records sequentially (or pinned to xlsx_row if present)
    4. Apply edge_lookup joins in separate pass
    5. Apply bumon matrix if configured
    """
    source = sheet_cfg["source"]
    records = masters.get(source, [])
    data_start = sheet_cfg["data_start_row"]
    style_row = sheet_cfg.get("style_template_row", data_start)
    columns = sheet_cfg["columns"]
    bumon_matrix = sheet_cfg.get("bumon_matrix")

    cols_in_use: list[int] = [d["col"] for d in columns]
    if bumon_matrix:
        cols_in_use.extend(range(bumon_matrix["start_col"], bumon_matrix["end_col"] + 1))

    style_template = {c: ws.cell(style_row, c) for c in cols_in_use}

    for r in range(data_start, ws.max_row + 1):
        for c in cols_in_use:
            ws.cell(r, c).value = None
        ws.row_dimensions[r].height = None

    sequential_r = data_start
    for record in records:
        target_r = record.get("xlsx_row")
        if target_r is None:
            r = sequential_r
            sequential_r += 1
        else:
            r = target_r

        for directive in columns:
            cell = ws.cell(r, directive["col"], value=render_value(directive, record, r, edges))
            if directive["col"] in style_template:
                copy_style(cell, style_template[directive["col"]])

        for directive in columns:
            if "edge_lookup" not in directive:
                continue
            cfg = directive["edge_lookup"]
            edge_list = edges.get(cfg["source"], [])
            match_field = list(cfg["match"].keys())[0]
            record_field = cfg["match"][match_field]
            record_val = record.get(record_field)
            for e in edge_list:
                if e.get(match_field) != record_val:
                    continue
                if all(e.get(k) == v for k, v in cfg.get("where", {}).items()):
                    cell = ws.cell(r, directive["col"], value=e.get(cfg["select"]))
                    if directive["col"] in style_template:
                        copy_style(cell, style_template[directive["col"]])
                    break

        if bumon_matrix:
            bumon = masters.get("bumon", [])
            edge_list = edges.get(bumon_matrix["edge_source"], [])
            id_field = bumon_matrix["edge_id_field"]
            mark_field = bumon_matrix["edge_mark_field"]
            record_id = record.get("id")
            edge_map = {
                e["bumon_id"]: e.get(mark_field)
                for e in edge_list
                if e.get(id_field) == record_id
            }
            for b in bumon:
                col = bumon_matrix["start_col"] + b["order"] - 1
                if col > bumon_matrix["end_col"]:
                    continue
                cell = ws.cell(r, col, value=edge_map.get(b["id"]))
                if col in style_template:
                    copy_style(cell, style_template[col])


def render_preserve(ws: Any, sheet_cfg: dict[str, Any], masters: dict[str, list[dict]], edges: dict[str, list[dict]]) -> None:
    """
    preserve strategy: keep template as-is, optionally apply cell_overrides.

    Use when template already contains formatted data or complex layouts.
    """
    for ov in sheet_cfg.get("cell_overrides", []):
        ws[ov["cell"]] = ov["value"]
