"""Chicandbath-only configurator matrix strategy.

This logic intentionally remains outside the common core until another brand
provides independent evidence for the same matrix semantics.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from ..extraction_core import (
    ExtractionError,
    center_x,
    center_y,
    elements_of_kind,
    finalize_extraction,
    stable_elements,
    validate_elements,
    validate_pairing_inputs,
)


def extract(fixture: Mapping[str, Any], rule: Mapping[str, Any]) -> dict[str, Any]:
    if rule.get("strategy") != "matrix_by_headers" or rule.get("strategyOwner") != "adapter":
        raise ExtractionError("unsupported_chicandbath_rule", "Chicandbath v1 requires its adapter-local matrix strategy.")

    elements, _ = validate_elements(fixture)
    subjects = elements_of_kind(elements, str(rule["subjectKind"]))
    values = elements_of_kind(elements, str(rule["valueKind"]))
    headers = elements_of_kind(elements, str(rule["headerKind"]))
    validate_pairing_inputs(subjects, values)

    row_tolerance = float(rule["rowTolerance"])
    column_tolerance = float(rule["columnTolerance"])
    right_tolerance = float(rule["rightSideTolerance"])
    if any(not math.isfinite(value) for value in (row_tolerance, column_tolerance, right_tolerance)):
        raise ExtractionError("invalid_tolerance", "Matrix tolerances must be finite.")
    if row_tolerance <= 0 or column_tolerance <= 0 or right_tolerance < 0:
        raise ExtractionError("invalid_tolerance", "Matrix tolerances are outside their valid range.")

    pairs: list[dict[str, Any]] = []
    diagnostics: list[dict[str, str]] = []
    for value in stable_elements(values):
        subject_candidates = []
        for subject in subjects:
            row_delta = abs(center_y(subject) - center_y(value))
            left_delta = float(value["box"]["x0"]) - float(subject["box"]["x1"])
            if row_delta <= row_tolerance and left_delta >= -right_tolerance:
                subject_candidates.append((row_delta, left_delta, str(subject["elementKey"]), subject))
        subject_candidates.sort(key=lambda item: (item[0], item[1], item[2]))

        header_candidates = []
        for header in headers:
            column_delta = abs(center_x(header) - center_x(value))
            vertical_delta = float(value["box"]["y0"]) - float(header["box"]["y1"])
            if column_delta <= column_tolerance and vertical_delta >= -row_tolerance:
                header_candidates.append((column_delta, vertical_delta, str(header["elementKey"]), header))
        header_candidates.sort(key=lambda item: (item[0], item[1], item[2]))

        subject = subject_candidates[0][3] if subject_candidates else None
        header = header_candidates[0][3] if header_candidates else None
        if subject is None or header is None or not header.get("headerKey"):
            diagnostics.append({"code": "incomplete_matrix_coordinate", "elementKey": str(value["elementKey"])})
            continue
        pairs.append(
            {
                "pairKey": f"{subject['elementKey']}:{header['headerKey']}",
                "subjectElementKey": subject["elementKey"],
                "valueElementKey": value["elementKey"],
                "headerElementKey": header["elementKey"],
                "qaState": subject["entity"]["qaState"],
            }
        )

    return finalize_extraction(subjects, values, headers, pairs, diagnostics)
