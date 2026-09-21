from __future__ import annotations

import posixpath
import re
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAX_XLSX_MEMBER_BYTES = 20 * 1024 * 1024
MAX_XLSX_TOTAL_BYTES = 50 * 1024 * 1024
EXPECTED_HEADERS = ["", "Código", "Descripción", "PVP", "ean"]


class SanyccesTariffError(RuntimeError):
    """Raised when the supplied Sanycces tariff cannot be trusted."""


def _tag(namespace: str, local_name: str) -> str:
    return f"{{{namespace}}}{local_name}"


def _column_index(reference: str) -> int:
    match = re.fullmatch(r"([A-Z]+)[1-9][0-9]*", reference)
    if match is None:
        raise SanyccesTariffError("tariff contains an invalid cell reference")
    result = 0
    for character in match.group(1):
        result = result * 26 + ord(character) - ord("A") + 1
    return result - 1


def _text(element: ElementTree.Element) -> str:
    return "".join(item.text or "" for item in element.iter(_tag(MAIN_NS, "t")))


def _cell_value(cell: ElementTree.Element, shared_strings: list[str]) -> str:
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        return _text(cell)
    value = cell.find(_tag(MAIN_NS, "v"))
    if value is None or value.text is None:
        return ""
    raw = value.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError) as error:
            raise SanyccesTariffError("tariff contains an invalid shared-string reference") from error
    return raw


def _read_xml(archive: zipfile.ZipFile, member: str) -> ElementTree.Element:
    try:
        return ElementTree.fromstring(archive.read(member))
    except (KeyError, ElementTree.ParseError) as error:
        raise SanyccesTariffError(f"tariff workbook member is invalid: {member}") from error


def _worksheet_member(archive: zipfile.ZipFile) -> tuple[str, str]:
    workbook = _read_xml(archive, "xl/workbook.xml")
    sheets = workbook.findall(f".//{_tag(MAIN_NS, 'sheet')}")
    if len(sheets) != 1:
        raise SanyccesTariffError("tariff workbook must contain exactly one worksheet")
    sheet = sheets[0]
    sheet_name = str(sheet.get("name", "")).strip()
    relationship_id = sheet.get(_tag(REL_NS, "id"))
    if not sheet_name or not relationship_id:
        raise SanyccesTariffError("tariff worksheet identity is missing")
    relationships = _read_xml(archive, "xl/_rels/workbook.xml.rels")
    targets = {
        relationship.get("Id"): relationship.get("Target")
        for relationship in relationships.findall(_tag(PACKAGE_REL_NS, "Relationship"))
    }
    target = targets.get(relationship_id)
    if not target:
        raise SanyccesTariffError("tariff worksheet relationship is missing")
    member = posixpath.normpath(posixpath.join("xl", target))
    if member.startswith("../") or member.startswith("/"):
        raise SanyccesTariffError("tariff worksheet relationship escapes the workbook")
    return sheet_name, member


def read_sanycces_price_tariff(path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if not members:
                raise SanyccesTariffError("tariff workbook is empty")
            total_size = 0
            for member in members:
                normalized = posixpath.normpath(member.filename)
                if normalized.startswith("../") or normalized.startswith("/"):
                    raise SanyccesTariffError("tariff workbook contains an unsafe member path")
                if member.file_size > MAX_XLSX_MEMBER_BYTES:
                    raise SanyccesTariffError("tariff workbook member exceeds the safety limit")
                total_size += member.file_size
            if total_size > MAX_XLSX_TOTAL_BYTES:
                raise SanyccesTariffError("tariff workbook exceeds the expanded-size safety limit")

            shared_root = _read_xml(archive, "xl/sharedStrings.xml")
            shared_strings = [_text(item) for item in shared_root.findall(_tag(MAIN_NS, "si"))]
            sheet_name, worksheet_member = _worksheet_member(archive)
            worksheet = _read_xml(archive, worksheet_member)
    except (OSError, zipfile.BadZipFile) as error:
        raise SanyccesTariffError("tariff workbook is not a readable XLSX file") from error

    dimension = worksheet.find(_tag(MAIN_NS, "dimension"))
    used_range = "" if dimension is None else str(dimension.get("ref", ""))
    rows: list[tuple[int, list[str]]] = []
    for row in worksheet.findall(f".//{_tag(MAIN_NS, 'row')}"):
        try:
            row_number = int(str(row.get("r", "")))
        except ValueError as error:
            raise SanyccesTariffError("tariff contains an invalid row number") from error
        values = [""] * 5
        for cell in row.findall(_tag(MAIN_NS, "c")):
            if cell.find(_tag(MAIN_NS, "f")) is not None:
                raise SanyccesTariffError("tariff must contain fixed source values, not formulas")
            reference = str(cell.get("r", ""))
            index = _column_index(reference)
            if index < len(values):
                values[index] = _cell_value(cell, shared_strings).strip()
        rows.append((row_number, values))

    if not rows or rows[0][0] != 1 or rows[0][1] != EXPECTED_HEADERS:
        raise SanyccesTariffError("tariff headers do not match the reviewed PVP Nacional layout")

    records: list[dict[str, Any]] = []
    footer_rows: list[dict[str, Any]] = []
    footer_started = False
    for row_number, values in rows[1:]:
        if values[0] == "PVPNA":
            if footer_started:
                raise SanyccesTariffError("tariff data resumes after the footer")
            code = values[1].upper()
            description = values[2]
            try:
                pvp = Decimal(values[3])
            except InvalidOperation as error:
                raise SanyccesTariffError(f"tariff row {row_number} has an invalid PVP") from error
            if not code or not description or not pvp.is_finite() or pvp < 0:
                raise SanyccesTariffError(f"tariff row {row_number} is incomplete")
            ean = values[4]
            ean_valid = not ean or re.fullmatch(r"[0-9]{8,14}", ean) is not None
            records.append(
                {
                    "sourceRow": row_number,
                    "tariffKey": values[0],
                    "reference": code,
                    "description": description,
                    "pvpExVat": pvp,
                    "ean": ean,
                    "eanStatus": "valid_or_blank" if ean_valid else "invalid_requires_review",
                }
            )
        else:
            footer_started = True
            footer_rows.append({"sourceRow": row_number, "values": values})

    normalized_footer = " ".join(
        value.casefold()
        for footer in footer_rows
        for value in footer["values"]
        if value
    )
    if "no se han aplicado filtros" not in normalized_footer:
        raise SanyccesTariffError("tariff footer does not confirm the unfiltered export")

    references = [record["reference"] for record in records]
    if not records or len(references) != len(set(references)):
        raise SanyccesTariffError("tariff references must be present and unique")
    explicit_tax_signals = sorted(
        {
            match.group(0)
            for text in shared_strings
            for match in re.finditer(r"\b(?:IVA|VAT|IMPUESTO)\b", text, re.IGNORECASE)
        }
    )
    return {
        "sheetName": sheet_name,
        "usedRange": used_range,
        "headers": EXPECTED_HEADERS,
        "records": records,
        "footerRows": footer_rows,
        "explicitTaxBasisSignals": explicit_tax_signals,
    }
