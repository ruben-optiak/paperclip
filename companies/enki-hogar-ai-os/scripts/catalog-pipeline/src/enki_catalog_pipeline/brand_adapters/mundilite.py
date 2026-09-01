"""Mundilite adapter: finish rows are variations; the base reference is not priced."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..extraction_core import ExtractionError, row_left_to_right


def extract(fixture: Mapping[str, Any], rule: Mapping[str, Any]) -> dict[str, Any]:
    if rule.get("strategy") != "row_left_to_right" or rule.get("strategyOwner") != "core":
        raise ExtractionError("unsupported_mundilite_rule", "Mundilite v1 accepts only the reviewed multi-brand row strategy.")
    if rule.get("subjectKind") != "finish":
        raise ExtractionError("invalid_mundilite_subject", "Mundilite finish pricing must pair finish rows, never the parent reference.")
    return row_left_to_right(fixture, rule)
