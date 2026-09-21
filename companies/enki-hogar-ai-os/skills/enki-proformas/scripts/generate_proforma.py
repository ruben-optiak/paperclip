#!/usr/bin/env python3
"""Generate a deterministic Enki proforma PDF and a PII-free receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


REQUEST_SCHEMA = "enki-proforma-request/v1"
COMPANY_SCHEMA = "enki-proforma-company-config/v1"
RECEIPT_SCHEMA = "enki-proforma-receipt/v1"
GENERATOR_VERSION = "1.0.1"
PROFORMA_TIMEZONE = "Europe/Madrid"
CENT = Decimal("0.01")
HUNDRED = Decimal("100")
SAFE_ID = re.compile(r"^[A-Za-z0-9._/-]{1,80}$")
DECIMAL_TEXT = re.compile(r"^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$")


class ValidationError(ValueError):
    pass


@dataclass(frozen=True)
class Totals:
    subtotal_net: Decimal
    line_discount_net: Decimal
    global_discount_net: Decimal
    total_discount_net: Decimal
    shipping_net: Decimal
    taxable_base: Decimal
    vat: Decimal
    total_gross: Decimal

    def strings(self) -> dict[str, str]:
        return {key: money_decimal(value) for key, value in asdict(self).items()}


def generate_proforma_number(now: datetime | None = None) -> str:
    """Return a compact 10-digit Unix timestamp and persist it in the request."""
    timezone = ZoneInfo(PROFORMA_TIMEZONE)
    current = datetime.now(timezone) if now is None else now.astimezone(timezone)
    return str(int(current.timestamp()))


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def request_sha256(request: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json_bytes(request)).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"No se pudo leer JSON válido en {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValidationError(f"{path.name} debe contener un objeto JSON")
    return value


def exact_keys(value: dict[str, Any], allowed: set[str], required: set[str], label: str) -> None:
    unknown = sorted(set(value) - allowed)
    missing = sorted(required - set(value))
    if unknown:
        raise ValidationError(f"{label} contiene campos no permitidos: {', '.join(unknown)}")
    if missing:
        raise ValidationError(f"{label} carece de campos obligatorios: {', '.join(missing)}")


def safe_text(value: Any, label: str, *, maximum: int, minimum: int = 1) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{label} debe ser texto")
    cleaned = " ".join(value.split()).replace("—", "-").replace("–", "-").replace("‑", "-")
    if len(cleaned) < minimum or len(cleaned) > maximum:
        raise ValidationError(f"{label} debe tener entre {minimum} y {maximum} caracteres")
    if any(ord(character) < 32 for character in cleaned):
        raise ValidationError(f"{label} contiene caracteres de control")
    return cleaned


def text_list(value: Any, label: str, *, minimum: int, maximum: int, item_maximum: int) -> list[str]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValidationError(f"{label} debe contener entre {minimum} y {maximum} elementos")
    return [safe_text(item, f"{label}[{index}]", maximum=item_maximum) for index, item in enumerate(value)]


def decimal_value(value: Any, label: str, *, maximum: Decimal | None = None) -> Decimal:
    if not isinstance(value, str) or not DECIMAL_TEXT.fullmatch(value):
        raise ValidationError(f"{label} debe ser un decimal positivo en texto con hasta dos decimales")
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValidationError(f"{label} no es un decimal válido") from exc
    if parsed < 0 or (maximum is not None and parsed > maximum):
        raise ValidationError(f"{label} está fuera del rango permitido")
    return parsed.quantize(CENT, rounding=ROUND_HALF_UP)


def parse_date(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{label} debe ser una fecha ISO")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValidationError(f"{label} debe usar YYYY-MM-DD") from exc


def validate_party(value: Any, label: str, *, require_tax_id: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} debe ser un objeto")
    allowed = {"name", "taxId", "addressLines", "email", "phone"}
    required = {"name", "addressLines"} | ({"taxId"} if require_tax_id else set())
    exact_keys(value, allowed, required, label)
    result: dict[str, Any] = {
        "name": safe_text(value["name"], f"{label}.name", maximum=120),
        "addressLines": text_list(value["addressLines"], f"{label}.addressLines", minimum=1, maximum=4, item_maximum=120),
    }
    for key, maximum in (("taxId", 40), ("email", 120), ("phone", 40)):
        if key in value and value[key] not in (None, ""):
            result[key] = safe_text(value[key], f"{label}.{key}", maximum=maximum)
    return result


def validate_request(value: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "schema", "issueKey", "proformaNumber", "date", "validUntil", "currency", "locale",
        "customer", "lines", "globalDiscountPercent", "shippingGross", "vatRate", "paymentMethod", "notes",
    }
    exact_keys(value, allowed, allowed, "request")
    if value["schema"] != REQUEST_SCHEMA:
        raise ValidationError(f"request.schema debe ser {REQUEST_SCHEMA}")
    issue_key = safe_text(value["issueKey"], "request.issueKey", maximum=80)
    number = safe_text(value["proformaNumber"], "request.proformaNumber", maximum=50)
    if not SAFE_ID.fullmatch(issue_key) or not SAFE_ID.fullmatch(number):
        raise ValidationError("issueKey y proformaNumber solo admiten letras, números, punto, guion, barra y guion bajo")
    issued = parse_date(value["date"], "request.date")
    valid_until = parse_date(value["validUntil"], "request.validUntil")
    if valid_until < issued:
        raise ValidationError("request.validUntil no puede ser anterior a request.date")
    if value["currency"] != "EUR" or value["locale"] != "es-ES":
        raise ValidationError("v1 solo admite currency=EUR y locale=es-ES")

    customer = value["customer"]
    if not isinstance(customer, dict):
        raise ValidationError("request.customer debe ser un objeto")
    exact_keys(customer, {"billing", "shippingSameAsBilling", "shipping"}, {"billing", "shippingSameAsBilling"}, "request.customer")
    if not isinstance(customer["shippingSameAsBilling"], bool):
        raise ValidationError("request.customer.shippingSameAsBilling debe ser booleano")
    billing = validate_party(customer["billing"], "request.customer.billing", require_tax_id=True)
    if customer["shippingSameAsBilling"]:
        if customer.get("shipping") not in (None, {}):
            raise ValidationError("shipping debe omitirse cuando shippingSameAsBilling=true")
        shipping = billing
    else:
        if "shipping" not in customer:
            raise ValidationError("shipping es obligatorio cuando shippingSameAsBilling=false")
        shipping = validate_party(customer["shipping"], "request.customer.shipping", require_tax_id=False)

    lines = value["lines"]
    if not isinstance(lines, list) or not 1 <= len(lines) <= 50:
        raise ValidationError("request.lines debe contener entre 1 y 50 líneas")
    normalized_lines = []
    line_allowed = {"sku", "variationId", "productName", "variationName", "quantity", "unitPriceGross", "lineDiscountPercent"}
    line_required = {"sku", "productName", "quantity", "unitPriceGross", "lineDiscountPercent"}
    for index, line in enumerate(lines):
        label = f"request.lines[{index}]"
        if not isinstance(line, dict):
            raise ValidationError(f"{label} debe ser un objeto")
        exact_keys(line, line_allowed, line_required, label)
        sku = safe_text(line["sku"], f"{label}.sku", maximum=80)
        if not SAFE_ID.fullmatch(sku):
            raise ValidationError(f"{label}.sku contiene caracteres no permitidos")
        quantity = line["quantity"]
        if not isinstance(quantity, int) or isinstance(quantity, bool) or not 1 <= quantity <= 999:
            raise ValidationError(f"{label}.quantity debe ser un entero entre 1 y 999")
        normalized_line = {
            "sku": sku,
            "productName": safe_text(line["productName"], f"{label}.productName", maximum=180),
            "quantity": quantity,
            "unitPriceGross": decimal_value(line["unitPriceGross"], f"{label}.unitPriceGross"),
            "lineDiscountPercent": decimal_value(line["lineDiscountPercent"], f"{label}.lineDiscountPercent", maximum=Decimal("100")),
        }
        for optional in ("variationId", "variationName"):
            if line.get(optional) not in (None, ""):
                normalized_line[optional] = safe_text(line[optional], f"{label}.{optional}", maximum=120)
        normalized_lines.append(normalized_line)

    return {
        "schema": REQUEST_SCHEMA,
        "issueKey": issue_key,
        "proformaNumber": number,
        "date": issued,
        "validUntil": valid_until,
        "currency": "EUR",
        "locale": "es-ES",
        "customer": {"billing": billing, "shipping": shipping, "shippingSameAsBilling": customer["shippingSameAsBilling"]},
        "lines": normalized_lines,
        "globalDiscountPercent": decimal_value(value["globalDiscountPercent"], "request.globalDiscountPercent", maximum=Decimal("100")),
        "shippingGross": decimal_value(value["shippingGross"], "request.shippingGross"),
        "vatRate": decimal_value(value["vatRate"], "request.vatRate", maximum=Decimal("30")),
        "paymentMethod": safe_text(value["paymentMethod"], "request.paymentMethod", maximum=80),
        "notes": text_list(value["notes"], "request.notes", minimum=0, maximum=8, item_maximum=240),
    }


def validate_company(value: dict[str, Any]) -> dict[str, Any]:
    allowed = {"schema", "demoMode", "legalName", "taxId", "addressLines", "email", "phone", "website", "bankName", "iban", "privacyText", "logoPath"}
    exact_keys(value, allowed, allowed, "companyConfig")
    if value["schema"] != COMPANY_SCHEMA:
        raise ValidationError(f"companyConfig.schema debe ser {COMPANY_SCHEMA}")
    if not isinstance(value["demoMode"], bool):
        raise ValidationError("companyConfig.demoMode debe ser booleano")
    result = {
        "schema": COMPANY_SCHEMA,
        "demoMode": value["demoMode"],
        "legalName": safe_text(value["legalName"], "companyConfig.legalName", maximum=120),
        "taxId": safe_text(value["taxId"], "companyConfig.taxId", maximum=40, minimum=0),
        "addressLines": text_list(value["addressLines"], "companyConfig.addressLines", minimum=1, maximum=4, item_maximum=120),
        "email": safe_text(value["email"], "companyConfig.email", maximum=120),
        "phone": safe_text(value["phone"], "companyConfig.phone", maximum=40, minimum=0),
        "website": safe_text(value["website"], "companyConfig.website", maximum=120),
        "bankName": safe_text(value["bankName"], "companyConfig.bankName", maximum=120),
        "iban": safe_text(value["iban"], "companyConfig.iban", maximum=50),
        "privacyText": safe_text(value["privacyText"], "companyConfig.privacyText", maximum=1600),
        "logoPath": None,
    }
    logo = value["logoPath"]
    if logo is not None:
        if not isinstance(logo, str) or not logo.strip():
            raise ValidationError("companyConfig.logoPath debe ser una ruta o null")
        logo_path = Path(logo).expanduser().resolve()
        if not logo_path.is_file():
            raise ValidationError("companyConfig.logoPath no existe")
        result["logoPath"] = logo_path
    return result


def calculate_line_net(line: dict[str, Any], vat_rate: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    divisor = Decimal("1") + vat_rate / HUNDRED
    gross = (line["unitPriceGross"] * line["quantity"]).quantize(CENT, rounding=ROUND_HALF_UP)
    before_discount = (gross / divisor).quantize(CENT, rounding=ROUND_HALF_UP)
    discount_net = (before_discount * line["lineDiscountPercent"] / HUNDRED).quantize(CENT, rounding=ROUND_HALF_UP)
    after_discount = (before_discount - discount_net).quantize(CENT, rounding=ROUND_HALF_UP)
    return before_discount, discount_net, after_discount


def calculate_totals(request: dict[str, Any]) -> Totals:
    subtotal_net = Decimal("0.00")
    line_discount_net = Decimal("0.00")
    after_line_discount_net = Decimal("0.00")
    for line in request["lines"]:
        before_discount, discount, after_discount = calculate_line_net(line, request["vatRate"])
        subtotal_net += before_discount
        line_discount_net += discount
        after_line_discount_net += after_discount
    shipping_net = request["shippingGross"].quantize(CENT, rounding=ROUND_HALF_UP)
    global_discount_net = (after_line_discount_net * request["globalDiscountPercent"] / HUNDRED).quantize(CENT, rounding=ROUND_HALF_UP)
    taxable_base = (after_line_discount_net - global_discount_net).quantize(CENT)
    vat = (taxable_base * request["vatRate"] / HUNDRED).quantize(CENT, rounding=ROUND_HALF_UP)
    total_gross = (taxable_base + vat + shipping_net).quantize(CENT)
    return Totals(
        subtotal_net=subtotal_net,
        line_discount_net=line_discount_net,
        global_discount_net=global_discount_net,
        total_discount_net=(line_discount_net + global_discount_net).quantize(CENT),
        shipping_net=shipping_net,
        taxable_base=taxable_base,
        vat=vat.quantize(CENT),
        total_gross=total_gross,
    )


def money_decimal(value: Decimal) -> str:
    return f"{value.quantize(CENT, rounding=ROUND_HALF_UP):.2f}"


def euro(value: Decimal) -> str:
    raw = f"{value.quantize(CENT, rounding=ROUND_HALF_UP):,.2f}"
    return raw.replace(",", "_").replace(".", ",").replace("_", ".") + " €"


def euro_unit(value: Decimal) -> str:
    return euro(value)


def percent(value: Decimal) -> str:
    return money_decimal(value).replace(".", ",") + " %"


def expected_output_name(request: dict[str, Any], digest: str, mode: str, *, final_appearance: bool = False) -> str:
    if mode == "draft":
        if final_appearance:
            return f"proforma-revision-{digest[:12]}.pdf"
        return f"proforma-borrador-{digest[:12]}.pdf"
    safe_number = re.sub(r"[^A-Za-z0-9._-]+", "-", request["proformaNumber"]).strip("-")
    return f"proforma-{safe_number}.pdf"


def receipt_payload(request: dict[str, Any], company: dict[str, Any], totals: Totals, mode: str, digest: str, output_path: Path) -> dict[str, Any]:
    return {
        "schema": RECEIPT_SCHEMA,
        "generatorVersion": GENERATOR_VERSION,
        "mode": mode,
        "requestSha256": digest,
        "companyConfigSha256": hashlib.sha256(canonical_json_bytes({key: str(value) if isinstance(value, Path) else value for key, value in company.items()})).hexdigest(),
        "pdfSha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "issueKey": request["issueKey"],
        "proformaNumber": request["proformaNumber"],
        "currency": request["currency"],
        "lineCount": len(request["lines"]),
        "productRefs": [{key: line[key] for key in ("sku", "variationId") if key in line} for line in request["lines"]],
        "totals": totals.strings(),
        "pii": {"includedInPdf": True, "includedInReceipt": False, "storage": "workspace_private_only"},
        "externalWrites": 0,
        "messageSent": False,
    }


def render_pdf(
    request: dict[str, Any],
    company: dict[str, Any],
    totals: Totals,
    output_path: Path,
    mode: str,
    digest: str,
    *,
    final_appearance: bool = False,
) -> None:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            Image, KeepTogether, LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
        )
    except ImportError as exc:
        raise RuntimeError("ReportLab no está instalado; usa el runtime documental de Codex") from exc

    brand = colors.HexColor("#243f3a")
    accent = colors.HexColor("#c89b66")
    ink = colors.HexColor("#1e2423")
    muted = colors.HexColor("#66736f")
    pale = colors.HexColor("#eef2f0")
    line_color = colors.HexColor("#d7dfdc")
    warning = colors.HexColor("#b42318")
    page_width, page_height = A4
    output_path.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.7, leading=12, textColor=ink)
    small = ParagraphStyle("Small", parent=body, fontSize=7.4, leading=9.5, textColor=muted)
    label = ParagraphStyle("Label", parent=small, fontName="Helvetica-Bold", fontSize=6.8, leading=8, textColor=muted, spaceAfter=2)
    table_header = ParagraphStyle("TableHeader", parent=label, textColor=colors.white)
    section = ParagraphStyle("Section", parent=body, fontName="Helvetica-Bold", fontSize=9.3, leading=12, textColor=brand, spaceAfter=5)
    product = ParagraphStyle("Product", parent=body, fontSize=8.1, leading=10.2)
    right = ParagraphStyle("Right", parent=body, alignment=TA_RIGHT)
    center = ParagraphStyle("Center", parent=body, alignment=TA_CENTER)

    def p(text: str, style: ParagraphStyle = body) -> Paragraph:
        escaped = str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return Paragraph(escaped, style)

    def party_block(title: str, party: dict[str, Any]) -> list[Any]:
        lines = [p(title.upper(), label), p(party["name"], ParagraphStyle("PartyName", parent=body, fontName="Helvetica-Bold", fontSize=9.2, leading=12))]
        if party.get("taxId"):
            lines.append(p(f"NIF/CIF: {party['taxId']}", small))
        lines.extend(p(item, small) for item in party["addressLines"])
        if party.get("email"):
            lines.append(p(party["email"], small))
        if party.get("phone"):
            lines.append(p(party["phone"], small))
        return lines

    def page_decor(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFillColor(brand)
        canvas.rect(0, page_height - 5 * mm, page_width, 5 * mm, fill=1, stroke=0)
        if mode == "draft" and not final_appearance:
            canvas.setFillColor(colors.Color(0.75, 0.08, 0.05, alpha=0.08))
            canvas.setFont("Helvetica-Bold", 38)
            canvas.translate(page_width / 2, page_height / 2)
            canvas.rotate(34)
            canvas.drawCentredString(0, 0, "BORRADOR - NO ENVIAR")
            canvas.rotate(-34)
            canvas.translate(-page_width / 2, -page_height / 2)
        canvas.setStrokeColor(line_color)
        canvas.line(18 * mm, 16 * mm, page_width - 18 * mm, 16 * mm)
        canvas.setFont("Helvetica", 6.5)
        canvas.setFillColor(muted)
        canvas.drawString(18 * mm, 11 * mm, f"Huella: {digest[:16]} · {GENERATOR_VERSION}")
        canvas.drawRightString(page_width - 18 * mm, 11 * mm, f"Página {document.page}")
        if document.page > 1:
            canvas.setFont("Helvetica-Bold", 7)
            canvas.drawString(18 * mm, page_height - 11 * mm, f"Proforma {request['proformaNumber']} - continuación")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(output_path), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=12 * mm, bottomMargin=18 * mm, title=f"Proforma {request['proformaNumber']}",
        author=company["legalName"], subject="Proforma comercial", invariant=1,
    )
    story: list[Any] = []

    if company.get("logoPath"):
        logo = Image(str(company["logoPath"]), width=42 * mm, height=18 * mm, kind="proportional")
        brand_cell: Any = logo
    else:
        brand_cell = Paragraph("<font size='20'><b>ENKI HOGAR</b></font>", ParagraphStyle("Brand", parent=body, textColor=brand, leading=14))
    status_text = "PROFORMA" if mode == "final" or final_appearance else "BORRADOR"
    company_contact = " · ".join(item for item in (company["taxId"], company["email"], company["phone"]) if item)
    heading = Table([
        [brand_cell, Paragraph(status_text, ParagraphStyle("DocType", parent=body, fontName="Helvetica-Bold", fontSize=18, leading=20, alignment=TA_RIGHT, textColor=brand))],
        [p(company["legalName"], small), p(f"N.º {request['proformaNumber']}", ParagraphStyle("Number", parent=body, fontName="Helvetica-Bold", fontSize=10, alignment=TA_RIGHT, textColor=ink))],
        [p(company_contact, small), p(f"Fecha {request['date']} · Válida hasta {request['validUntil']}", ParagraphStyle("Dates", parent=small, alignment=TA_RIGHT))],
    ], colWidths=[92 * mm, 82 * mm])
    heading.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, -1), (-1, -1), 0.8, accent),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
    ]))
    story.extend([heading, Spacer(1, 3 * mm)])

    customer_table = Table([
        [party_block("Facturación", request["customer"]["billing"]), party_block("Entrega", request["customer"]["shipping"])],
    ], colWidths=[87 * mm, 87 * mm])
    customer_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), pale),
        ("BOX", (0, 0), (-1, -1), 0.6, line_color),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, line_color),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([customer_table, Spacer(1, 3 * mm), p("Detalle", section)])

    line_rows: list[list[Any]] = [[
        p("PRODUCTO / REFERENCIA", table_header), p("CANT.", table_header),
        p("PRECIO UNIDAD", table_header), p("DTO.", table_header),
        p("IVA", table_header), p("PRECIO TOTAL", table_header),
    ]]
    divisor = Decimal("1") + request["vatRate"] / HUNDRED
    for line in request["lines"]:
        line_total_net, _, _ = calculate_line_net(line, request["vatRate"])
        subtitle = f"Ref. {line['sku']}"
        if line.get("variationName"):
            subtitle += f" · {line['variationName']}"
        product_text = f"<b>{line['productName']}</b><br/><font color='#66736f' size='7'>{subtitle}</font>"
        line_rows.append([
            Paragraph(product_text, product), p(str(line["quantity"]), center), p(euro_unit(line["unitPriceGross"] / divisor), right),
            p(percent(line["lineDiscountPercent"]), right), p(percent(request["vatRate"]), right), p(euro(line_total_net), right),
        ])
    product_table = LongTable(line_rows, colWidths=[68 * mm, 14 * mm, 28 * mm, 18 * mm, 18 * mm, 28 * mm], repeatRows=1)
    product_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.45, line_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.extend([product_table, Spacer(1, 3 * mm)])

    totals_rows = [
        [p("Subtotal sin IVA", small), p(euro(totals.subtotal_net), right)],
        [p("Descuento", small), p("− " + euro(totals.total_discount_net), right)],
        [p("Base imponible", small), p(euro(totals.taxable_base), right)],
        [p(f"IVA ({percent(request['vatRate'])})", small), p(euro(totals.vat), right)],
        [p("Portes sin IVA", small), p(euro(totals.shipping_net), right)],
        [p("TOTAL (IVA INCLUIDO)", ParagraphStyle("TotalLabel", parent=body, fontName="Helvetica-Bold", fontSize=11, textColor=colors.white)), p(euro(totals.total_gross), ParagraphStyle("TotalValue", parent=body, fontName="Helvetica-Bold", fontSize=12, alignment=TA_RIGHT, textColor=colors.white))],
    ]
    totals_table = Table(totals_rows, colWidths=[52 * mm, 33.5 * mm], hAlign="RIGHT")
    totals_table.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -2), 0.35, line_color),
        ("BACKGROUND", (0, -1), (-1, -1), brand),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

    payment_title = "Forma de pago"
    payment_lines = [p(payment_title, section), p(request["paymentMethod"], body)]
    if "transferencia" in request["paymentMethod"].lower():
        transfer_concept = f"{request['customer']['billing']['name']} - {request['proformaNumber']}"
        payment_lines.extend([
            p(f"Entidad: {company['bankName']}", small),
            p(f"IBAN: {company['iban']}", ParagraphStyle("Iban", parent=body, fontName="Helvetica-Bold", textColor=brand)),
            Spacer(1, 2 * mm),
            p("Indique como concepto el nombre del comprador y el número de proforma:", small),
            p(transfer_concept, ParagraphStyle("TransferConcept", parent=small, fontName="Helvetica-Bold", textColor=ink)),
        ])
    valid_until_display = date.fromisoformat(request["validUntil"]).strftime("%d/%m/%Y")
    note_lines: list[Any] = [p("Condiciones", section), p(f"Oferta válida hasta el {valid_until_display}.", small)]
    commercial_summary = payment_lines + [Spacer(1, 4 * mm)] + note_lines
    closing = Table([[commercial_summary, totals_table]], colWidths=[84 * mm, 90 * mm])
    closing.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, line_color),
        ("LINEAFTER", (0, 0), (0, 0), 0.6, line_color),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 8),
        ("RIGHTPADDING", (0, 0), (0, 0), 8),
        ("LEFTPADDING", (1, 0), (1, 0), 6),
        ("RIGHTPADDING", (1, 0), (1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    legal = ParagraphStyle("Legal", parent=small, fontSize=5.2, leading=6.0, textColor=muted)
    legal_block: list[Any] = [
        p("Protección de datos", ParagraphStyle("LegalHeading", parent=legal, fontName="Helvetica-Bold", textColor=brand, spaceAfter=2)),
        p(company["privacyText"], legal),
    ]
    if company["demoMode"] and not final_appearance:
        legal_block.extend([Spacer(1, 2 * mm), p("CONFIGURACIÓN DE DEMOSTRACIÓN - SIN VALIDEZ COMERCIAL", ParagraphStyle("Demo", parent=small, fontName="Helvetica-Bold", textColor=warning, alignment=TA_CENTER))])
    story.extend([KeepTogether([closing, Spacer(1, 2 * mm)]), KeepTogether(legal_block)])

    doc.build(story, onFirstPage=page_decor, onLaterPages=page_decor)


def write_receipt(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path)
    parser.add_argument("--company-config", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--mode", choices=("draft", "final"), default="draft")
    parser.add_argument("--authorization-sha256")
    parser.add_argument("--print-request-sha256", action="store_true")
    parser.add_argument("--print-new-proforma-number", action="store_true")
    parser.add_argument("--final-appearance", action="store_true", help="Oculta marcas de borrador solo para revisión visual; no autoriza ni finaliza")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        if args.print_new_proforma_number:
            if any((args.request, args.company_config, args.output, args.receipt, args.authorization_sha256, args.print_request_sha256, args.final_appearance)) or args.mode != "draft":
                raise ValidationError("--print-new-proforma-number debe ejecutarse sin otras opciones")
            print(generate_proforma_number())
            return 0
        if args.request is None or args.company_config is None:
            raise ValidationError("--request y --company-config son obligatorios")
        raw_request = load_json(args.request)
        request = validate_request(raw_request)
        company = validate_company(load_json(args.company_config))
        digest = request_sha256(raw_request)
        if args.print_request_sha256:
            print(digest)
            return 0
        if args.output is None:
            raise ValidationError("--output es obligatorio salvo con --print-request-sha256")
        if args.mode == "final":
            if args.final_appearance:
                raise ValidationError("--final-appearance solo se admite en modo draft")
            if company["demoMode"]:
                raise ValidationError("una configuración demo no puede generar una proforma final")
            if not company["taxId"] or not company["phone"]:
                raise ValidationError("una proforma final requiere NIF/CIF y teléfono de empresa")
            if args.authorization_sha256 != digest:
                raise ValidationError("la autorización no coincide con la huella exacta del request")
        expected_name = expected_output_name(request, digest, args.mode, final_appearance=args.final_appearance)
        if args.output.name != expected_name:
            raise ValidationError(f"el nombre de salida debe ser {expected_name}; no incluyas PII en el nombre")
        totals = calculate_totals(request)
        render_pdf(request, company, totals, args.output, args.mode, digest, final_appearance=args.final_appearance)
        if args.receipt:
            expected_receipt = f"proforma-receipt-{digest[:12]}.json"
            if args.receipt.name != expected_receipt:
                raise ValidationError(f"el nombre del recibo debe ser {expected_receipt}")
            write_receipt(args.receipt, receipt_payload(request, company, totals, args.mode, digest, args.output))
        print(json.dumps({"mode": args.mode, "requestSha256": digest, "output": str(args.output), "totals": totals.strings()}, ensure_ascii=False))
        return 0
    except (ValidationError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
