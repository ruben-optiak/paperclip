"""Brand-neutral geometry primitives for catalogue extraction.

Only behavior backed by more than one brand may be promoted here.  The
registry records that evidence; single-brand strategies stay in their brand
adapter module.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any


class ExtractionError(ValueError):
    """A deterministic candidate page cannot be evaluated safely."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def center_x(element: Mapping[str, Any]) -> float:
    box = element["box"]
    return (float(box["x0"]) + float(box["x1"])) / 2


def center_y(element: Mapping[str, Any]) -> float:
    box = element["box"]
    return (float(box["y0"]) + float(box["y1"])) / 2


def stable_elements(elements: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    return sorted(elements, key=lambda item: (center_y(item), center_x(item), str(item["elementKey"])))


def validate_elements(fixture: Mapping[str, Any]) -> tuple[list[Mapping[str, Any]], dict[str, Mapping[str, Any]]]:
    source = fixture.get("source")
    if not isinstance(source, Mapping):
        raise ExtractionError("missing_source", "Candidate page requires source geometry.")
    page_width = source.get("pageWidth")
    page_height = source.get("pageHeight")
    if not _positive_number(page_width) or not _positive_number(page_height):
        raise ExtractionError("invalid_page_geometry", "Page width and height must be finite positive numbers.")

    elements = fixture.get("elements")
    if not isinstance(elements, list) or not elements:
        raise ExtractionError("missing_elements", "Candidate page requires at least one element.")

    by_key: dict[str, Mapping[str, Any]] = {}
    for index, element in enumerate(elements):
        if not isinstance(element, Mapping):
            raise ExtractionError("invalid_element", f"Element {index} must be an object.")
        key = element.get("elementKey")
        if not isinstance(key, str) or not key:
            raise ExtractionError("invalid_element_key", f"Element {index} requires a stable key.")
        if key in by_key:
            raise ExtractionError("duplicate_element_key", f"Duplicate element key: {key}.")
        box = element.get("box")
        if not isinstance(box, Mapping):
            raise ExtractionError("invalid_geometry", f"Element {key} requires a bounding box.")
        coordinates = [box.get(name) for name in ("x0", "y0", "x1", "y1")]
        if not all(_finite_number(value) for value in coordinates):
            raise ExtractionError("invalid_geometry", f"Element {key} has non-finite coordinates.")
        x0, y0, x1, y1 = (float(value) for value in coordinates)
        if x0 < 0 or y0 < 0 or x0 >= x1 or y0 >= y1 or x1 > float(page_width) or y1 > float(page_height):
            raise ExtractionError("invalid_geometry", f"Element {key} must remain inside the page with positive area.")
        by_key[key] = element
    return elements, by_key


def elements_of_kind(elements: Sequence[Mapping[str, Any]], kind: str) -> list[Mapping[str, Any]]:
    return [element for element in elements if element.get("kind") == kind]


def validate_pairing_inputs(
    subjects: Sequence[Mapping[str, Any]],
    values: Sequence[Mapping[str, Any]],
) -> None:
    for subject in subjects:
        entity = subject.get("entity")
        if not isinstance(entity, Mapping) or not isinstance(entity.get("qaState"), str):
            raise ExtractionError("missing_subject_entity", f"Subject {subject['elementKey']} requires a typed QA entity.")
    for value in values:
        if value.get("rawValue") is None or value.get("normalizedValue") is None:
            raise ExtractionError("missing_value", f"Value {value['elementKey']} requires raw and normalized values.")


def group_rows(elements: Sequence[Mapping[str, Any]], tolerance: float) -> list[dict[str, Any]]:
    if not _positive_number(tolerance):
        raise ExtractionError("invalid_tolerance", "Row tolerance must be a finite positive number.")
    rows: list[dict[str, Any]] = []
    for element in stable_elements(elements):
        row = next((candidate for candidate in rows if abs(float(candidate["center"]) - center_y(element)) <= tolerance), None)
        if row is None:
            rows.append({"center": center_y(element), "elements": [element]})
            continue
        row["elements"].append(element)
        row["center"] = sum(center_y(item) for item in row["elements"]) / len(row["elements"])
    return rows


def row_left_to_right(fixture: Mapping[str, Any], rule: Mapping[str, Any]) -> dict[str, Any]:
    """Pair subjects to right-side values by row.

    This strategy is core-owned only because the adapter registry demonstrates
    it independently on Buades, Enki Espejos and Mundilite fixtures.
    """

    elements, elements_by_key = validate_elements(fixture)
    subjects = elements_of_kind(elements, str(rule["subjectKind"]))
    values = elements_of_kind(elements, str(rule["valueKind"]))
    validate_pairing_inputs(subjects, values)

    header_key = rule.get("evidenceHeaderElementKey")
    if header_key is not None and header_key not in elements_by_key:
        raise ExtractionError("missing_evidence_header", f"Evidence header {header_key} does not exist.")

    row_tolerance = float(rule["rowTolerance"])
    right_tolerance = float(rule["rightSideTolerance"])
    if right_tolerance < 0 or not math.isfinite(right_tolerance):
        raise ExtractionError("invalid_tolerance", "Right-side tolerance must be finite and non-negative.")

    subject_rows = group_rows(subjects, row_tolerance)
    value_rows = group_rows(values, row_tolerance)
    pairs: list[dict[str, Any]] = []
    diagnostics: list[dict[str, str]] = []

    for subject_row in subject_rows:
        nearby_rows = [
            (abs(float(row["center"]) - float(subject_row["center"])), row)
            for row in value_rows
            if abs(float(row["center"]) - float(subject_row["center"])) <= row_tolerance
        ]
        nearby_rows.sort(key=lambda item: (item[0], float(item[1]["center"])))
        if not nearby_rows:
            for subject in subject_row["elements"]:
                diagnostics.append({"code": "missing_value_row", "elementKey": str(subject["elementKey"])})
            continue

        row_subjects = sorted(subject_row["elements"], key=lambda item: (center_x(item), str(item["elementKey"])))
        row_values = sorted(nearby_rows[0][1]["elements"], key=lambda item: (center_x(item), str(item["elementKey"])))
        one_to_one = len(row_values) >= len(row_subjects)
        available = list(row_values)
        for subject in row_subjects:
            candidate_pool = available if one_to_one else row_values
            candidates = [
                value
                for value in candidate_pool
                if float(value["box"]["x0"]) + right_tolerance >= float(subject["box"]["x0"])
            ]
            if not candidates:
                diagnostics.append({"code": "missing_right_side_value", "elementKey": str(subject["elementKey"])})
                continue
            selected = candidates[0]
            if one_to_one:
                available = [value for value in available if value["elementKey"] != selected["elementKey"]]
            pairs.append(
                {
                    "pairKey": f"{subject['elementKey']}:{selected['elementKey']}",
                    "subjectElementKey": subject["elementKey"],
                    "valueElementKey": selected["elementKey"],
                    "headerElementKey": header_key,
                    "qaState": subject["entity"]["qaState"],
                }
            )

    return finalize_extraction(subjects, values, [], pairs, diagnostics)


def finalize_extraction(
    subjects: Sequence[Mapping[str, Any]],
    values: Sequence[Mapping[str, Any]],
    headers: Sequence[Mapping[str, Any]],
    pairs: Sequence[Mapping[str, Any]],
    diagnostics: Sequence[Mapping[str, str]],
) -> dict[str, Any]:
    pair_keys = [str(pair["pairKey"]) for pair in pairs]
    if len(pair_keys) != len(set(pair_keys)):
        raise ExtractionError("duplicate_pair_key", "Extraction produced duplicate pair keys.")
    paired_subjects = {str(pair["subjectElementKey"]) for pair in pairs}
    paired_values = {str(pair["valueElementKey"]) for pair in pairs}
    subject_count = len(subjects)
    coverage = len(paired_subjects) / subject_count if subject_count else 0.0
    return {
        "pairs": [dict(pair) for pair in pairs],
        "diagnostics": [dict(item) for item in diagnostics],
        "metrics": {
            "subjectCount": subject_count,
            "valueCount": len(values),
            "headerCount": len(headers),
            "pairCount": len(pairs),
            "pairedSubjectCount": len(paired_subjects),
            "pairedValueCount": len(paired_values),
            "unpairedSubjectCount": subject_count - len(paired_subjects),
            "unusedValueCount": len(values) - len(paired_values),
            "subjectCoverage": round(coverage, 6),
            "diagnosticCount": len(diagnostics),
        },
    }


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _positive_number(value: Any) -> bool:
    return _finite_number(value) and float(value) > 0
