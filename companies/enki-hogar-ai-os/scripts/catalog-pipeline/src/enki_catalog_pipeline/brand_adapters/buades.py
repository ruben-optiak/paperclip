"""Buades adapter: only snapshot-scoped rules belong here."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..extraction_core import ExtractionError, row_left_to_right


def extract(fixture: Mapping[str, Any], rule: Mapping[str, Any]) -> dict[str, Any]:
    if rule.get("strategy") != "row_left_to_right" or rule.get("strategyOwner") != "core":
        raise ExtractionError("unsupported_buades_rule", "Buades v1 accepts only the reviewed multi-brand row strategy.")
    return row_left_to_right(fixture, rule)
