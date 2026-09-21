from __future__ import annotations

import csv
import html
import json
import re
import shutil
import unicodedata
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable

import pdfplumber

from . import PIPELINE_VERSION
from .pipeline import sha256_file
from .product_media import load_media_profile, render_product_media_candidate
from .safety import DataWorkspace, validate_run_id
from .sanycces_products import (
    ANALYSIS_SCHEMA,
    SanyccesAnalysisError,
    load_sanycces_adapter,
    read_woo_snapshot,
)
from .sanycces_tariff import read_sanycces_price_tariff


POOL_PREPARATION_SCHEMA = "enki-sanycces-pool-preparation/v1"
POOL_EXPECTED_INVENTORY_GROUPS = 28
POOL_EXPECTED_PRODUCT_CANDIDATES = 24
POOL_EXPECTED_COMPONENTS = 4
POOL_EXPECTED_OFFICIAL_CARDS = 26
VAT_RATE = Decimal("0.21")
MONEY_QUANTUM = Decimal("0.01")
SANYCCES_DISCOUNT_POLICY_KEY = "sanycces-pvp-tier-2026-v1"
SANYCCES_DISCOUNT_TIERS: tuple[tuple[Decimal | None, Decimal], ...] = (
    (Decimal("25.00"), Decimal("5.00")),
    (Decimal("50.00"), Decimal("7.50")),
    (Decimal("100.00"), Decimal("10.00")),
    (Decimal("250.00"), Decimal("15.00")),
    (Decimal("500.00"), Decimal("17.50")),
    (None, Decimal("20.00")),
)
CARDIFF_COMPOSITE_COMPONENTS: dict[str, tuple[str, ...]] = {
    ".G": ("SOLIDMEC",),
    ".T": ("SOLIDTWMEC",),
    ".TG": ("SOLIDMEC", "SOLIDTWMEC"),
}


class SanyccesPoolError(RuntimeError):
    """Raised when the Pool preparation or live reconciliation is not provable."""


def _identity(base_reference: str, configuration_tail: str = "") -> str:
    return f"{base_reference}::{configuration_tail}"


POOL_TITLES: dict[str, str] = {
    _identity("BNBB006SS"): "Monomando de borde de bañera Pool",
    _identity("BNCA006SS"): "Caño de bañera mural Pool",
    _identity("BNEX006SS"): "Grifería de pie para bañera Pool",
    _identity("COMO006SS"): "Columna de ducha monomando Pool",
    _identity("COTE006SS"): "Columna de ducha termostática Pool",
    _identity("DUE006SS"): "Ducha de exterior monomando Pool",
    _identity("MBD006SS"): "Monomando de bidé Pool",
    _identity("MEN006R14SS"): "Monomando de lavabo mural Pool sin placa, caño de 14 cm",
    _identity("MEN006R18SS"): "Monomando de lavabo mural Pool sin placa, caño de 18 cm",
    _identity("MEN006S14SS"): "Monomando de lavabo mural Pool con placa, caño de 14 cm",
    _identity("MEN006S18SS"): "Monomando de lavabo mural Pool con placa, caño de 18 cm",
    _identity("MEX006SS"): "Monomando exento de lavabo Pool",
    _identity("MH2D006SS"): "Monomando de ducha mural horizontal Pool 2 vías, versión 006",
    _identity("MH2D066SS"): "Monomando de ducha mural horizontal Pool 2 vías, versión 066",
    _identity("MNO006SS"): "Monomando de lavabo Pool",
    _identity("MOA006SS"): "Monomando alto de lavabo Pool",
    _identity("ROC006SS"): "Rociador de ducha mural Pool",
    _identity("ROT006SS"): "Rociador de ducha a techo Pool",
    _identity("TH2D006SS"): "Termostático de ducha mural horizontal Pool 2-3 vías, versión 006",
    _identity("TH2D066SS"): "Termostático de ducha mural horizontal Pool 2-3 vías, versión 066",
    _identity("MH2D006SS", "K"): "Kit monomando mural Pool 006 con rociador",
    _identity("MH2D066SS", "K"): "Kit monomando mural Pool 066 con rociador",
    _identity("TH2D006SS", "K"): "Kit termostático mural Pool 006 con rociador",
    _identity("TH2D066SS", "K"): "Kit termostático mural Pool 066 con rociador",
    _identity("MEN000SS"): "Sanybox Inox para monomando de lavabo mural Pool",
    _identity("MH2000SS"): "Sanybox Inox para monomando horizontal Pool 2 vías",
    _identity("RAC00012SS"): "Sanybox Inox conexión 1/2 para caño Pool",
    _identity("TH2000SS"): "Sanybox Inox para termostático horizontal Pool 2-3 vías",
}


POOL_CATEGORY_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("MNO", "Grifos de baño > Grifos Lavabo"),
    ("MOA", "Grifos de baño > Grifos Lavabo > Grifos lavabo caño alto"),
    ("MBD", "Grifos de baño > Grifo WC/Bidé"),
    ("MEN", "Grifos de baño > Grifos Lavabo > Grifos de lavabo empotrados"),
    ("MEX", "Grifos de baño > Grifos Lavabo > Grifos lavabo caño alto"),
    ("BNBB", "Grifos de baño > Grifos Bañera > Grifos bañera monomando"),
    ("BNCA", "Grifos de baño > Grifos Bañera"),
    ("BNEX", "Grifos de baño > Grifos Bañera > Grifos bañera exenta"),
    ("MH", "Grifos de baño > Grifos Ducha > Grifos ducha empotrados"),
    ("TH", "Grifos de baño > Grifos Ducha > Grifos ducha termostáticos"),
    ("COMO", "Grifos de baño > Columnas ducha"),
    ("COTE", "Grifos de baño > Columnas ducha"),
    ("ROC", "Grifos de baño > Grifos Ducha > Rociadores"),
    ("ROT", "Grifos de baño > Grifos Ducha > Rociadores"),
    ("DUE", "Grifos de baño > Grifos Ducha"),
    ("RAC", "Fontanería > Sanybox"),
)


POOL_TECHNICAL_HIGHLIGHTS: dict[str, list[str]] = {
    "MNO006SS": [
        "Acero inoxidable 316L",
        "Apertura en frío y ahorro de energía",
        "Caudal de 5,7 l/min a 3 bar",
        "Aireador Neoperl, cartucho Sedal y latiguillos Tucai",
        "Preparado para válvula click-clack; válvula no incluida",
    ],
    "MOA006SS": [
        "Acero inoxidable 316L",
        "Apertura en frío y ahorro de energía",
        "Caudal de 5,8 l/min a 3 bar",
        "Aireador Neoperl, cartucho Sedal y latiguillos Tucai",
        "Preparado para válvula click-clack; válvula no incluida",
    ],
    "MBD006SS": [
        "Acero inoxidable 316L",
        "Apertura en frío y ahorro de energía",
        "Caudal de 5,4 l/min a 3 bar",
        "Aireador orientable Neoperl, cartucho Sedal y latiguillos Tucai",
        "Preparado para válvula click-clack; válvula no incluida",
    ],
    "MEN006": [
        "Acero inoxidable 316L",
        "Apertura en frío, ahorro de energía y ahorro de agua",
        "Caudal de 4,7 l/min a 3 bar",
        "Aireador Neoperl",
        "Parte externa; requiere el cuerpo de encastre Sanybox Inox MEN000SS",
        "Configuración de mano derecha por defecto; admite cambio de mano",
    ],
    "MEN000SS": [
        "Cuerpo de encastre Sanybox Inox",
        "Diseñado para el monomando de lavabo mural Pool",
        "Componente requerido por las referencias murales MEN006",
    ],
    "MEX006SS": [
        "Acero inoxidable 316L",
        "Apertura en frío y ahorro de energía y agua",
        "Caudal de 4,7 l/min a 3 bar",
        "Cartucho Sedal y aireador Neoperl",
    ],
    "BNEX006SS": [
        "Acero inoxidable 316L",
        "Monomando de pie para bañera",
        "Caudal de 20 l/min a 3 bar",
        "Aireador Neoperl y flexo trenzado de 1,5 m",
        "Limitador de caudal y cartucho Kerox",
    ],
    "BNBB006SS": [
        "Acero inoxidable 316L",
        "Monomando de borde de bañera",
        "Caudal de 18,8 l/min a 3 bar",
        "Cartucho Sedal, aireador Neoperl y limitador de caudal",
        "Flexo de 2 m",
    ],
    "BNCA006SS": [
        "Acero inoxidable 316L",
        "Caño mural para bañera",
        "Aireador Neoperl",
        "Conexión G 1/2",
    ],
    "RAC00012SS": [
        "Conexión Sanybox Inox de 1/2",
        "Compatible con las configuraciones Pool BNCA006 y ROC006",
    ],
    "MH2D": [
        "Acero inoxidable 316L",
        "Monomando horizontal de 2 vías",
        "Limitador de caudal de 9 l/min",
        "Flexo trenzado de 1,5 m y sistema antitorsión",
        "Parte externa; requiere el cuerpo de encastre Sanybox Inox MH2000SS",
    ],
    "MH2000SS": [
        "Cuerpo de encastre Sanybox Inox para monomando horizontal de 2 vías",
        "Caudal de 16,3 l/min a 3 bar",
        "Cartucho Sedal y conexiones hembra de 1/2",
    ],
    "TH2D": [
        "Acero inoxidable 316L",
        "Mezclador termostático horizontal de 2-3 vías",
        "Limitador de caudal de 9 l/min",
        "Flexo trenzado de 1,5 m y sistema antitorsión",
        "Parte externa; requiere el cuerpo de encastre Sanybox Inox TH2000SS",
    ],
    "TH2000SS": [
        "Cuerpo de encastre Sanybox Inox para termostático horizontal de 2-3 vías",
        "Cartucho termostático Vernet",
        "Conexiones hembra de 1/2",
    ],
    "COMO006SS": [
        "Acero inoxidable 316L",
        "Columna de ducha monomando",
        "Limitador de caudal de 9 l/min",
        "Altura regulable, soporte deslizante y orientable",
        "Flexo trenzado de 1,5 m y cartucho Sedal",
    ],
    "COTE006SS": [
        "Acero inoxidable 316L",
        "Columna de ducha termostática",
        "Limitador de caudal de 9 l/min y ahorro de agua",
        "Altura regulable y soporte deslizante y orientable",
        "Flexo trenzado de 1,5 m",
    ],
    "ROC006SS": [
        "Acero inoxidable 316L",
        "Rociador mural",
        "Limitador de caudal de 9 l/min",
        "Tetinas antical y ahorro de agua",
    ],
    "ROT006SS": [
        "Acero inoxidable 316L",
        "Rociador a techo",
        "Limitador de caudal de 9 l/min",
        "Tetinas antical y ahorro de agua",
    ],
    "DUE006SS": [
        "Acero inoxidable 316L",
        "Ducha de exterior monomando",
        "Limitador de caudal de 9 l/min y ahorro de agua",
        "Tetinas antical y conexiones hembra de 1/2",
    ],
}


OFFICIAL_ASSETS: dict[str, dict[str, str]] = {
    "pool-cote": {
        "url": "https://sanycces.es/producto/pool-columna-de-ducha-termostatica/",
        "file": "cote.png",
    },
    "pool-como": {
        "url": "https://sanycces.es/producto/pool_columna-de-ducha-monomando/",
        "file": "como.png",
    },
    "pool-due": {
        "url": "https://sanycces.es/producto/pool-ducha-de-exterior/",
        "file": "due.png",
    },
    "pool-rot": {
        "url": "https://sanycces.es/producto/pool-rociador-de-ducha-a-techo/",
        "file": "rot.png",
    },
    "pool-roc": {
        "url": "https://sanycces.es/producto/pool_rociador-de-ducha_pared/",
        "file": "roc.png",
    },
    "pool-th2d066": {
        "url": "https://sanycces.es/producto/pool-termostatico-ducha-mural-horizontal-2/",
        "file": "th2d066.png",
    },
    "pool-th2d006": {
        "url": "https://sanycces.es/producto/pool-termostaticoducha_mural_horizontal/",
        "file": "th2d006.png",
    },
    "pool-mh2d066": {
        "url": "https://sanycces.es/producto/pool_monomando-ducha_horizontal_2/",
        "file": "mh2d066.png",
    },
    "pool-mh2d006": {
        "url": "https://sanycces.es/producto/pool-monomando-ducha-horizontal/",
        "file": "mh2d006.png",
    },
    "pool-bnca": {
        "url": "https://sanycces.es/producto/pool_cano_banera/",
        "file": "bnca.png",
    },
    "pool-men-r": {
        "url": "https://sanycces.es/producto/pool-monomando-lavabo-mural/",
        "file": "men-r.png",
    },
    "pool-men-s": {
        "url": "https://sanycces.es/producto/pool-monomando-de-lavabo-mural-con-placa/",
        "file": "men-s.png",
    },
    "pool-mex": {
        "url": "https://sanycces.es/producto/pool-monomando-exento-lavabo/",
        "file": "mex.png",
    },
    "pool-bnbb": {
        "url": "https://sanycces.es/producto/pool-monomando-borde-banera/",
        "file": "bnbb.png",
    },
    "pool-mno": {
        "url": "https://sanycces.es/producto/pool_monomando_lavabo/",
        "file": "mno.png",
    },
    "pool-moa": {
        "url": "https://sanycces.es/producto/pool_monomando_alto_lavabo/",
        "file": "moa.png",
    },
    "pool-bnex": {
        "url": "https://sanycces.es/producto/pool_griferia_pie_banera/",
        "file": "bnex.png",
    },
    "pool-mbd": {
        "url": "https://sanycces.es/producto/pool/",
        "file": "mbd.png",
    },
    "pool-men000": {
        "url": "https://sanycces.es/producto/sanybox-inox/",
        "file": "men000.png",
    },
    "pool-mh2000": {
        "url": "https://sanycces.es/producto/sanybox-inox-monomando_horizontal_ducha/",
        "file": "mh2000.png",
    },
    "pool-rac00012": {
        "url": "https://sanycces.es/producto/sanybox-inox_conexion/",
        "file": "rac00012.png",
    },
    "pool-th2000": {
        "url": "https://sanycces.es/producto/sanybox-inox-termostatico-horizontal-2-3-vias-mural/",
        "file": "th2000.png",
    },
}


GROUP_ASSET_KEYS: dict[str, str] = {
    _identity("BNBB006SS"): "pool-bnbb",
    _identity("BNCA006SS"): "pool-bnca",
    _identity("BNEX006SS"): "pool-bnex",
    _identity("COMO006SS"): "pool-como",
    _identity("COTE006SS"): "pool-cote",
    _identity("DUE006SS"): "pool-due",
    _identity("MBD006SS"): "pool-mbd",
    _identity("MEN006R14SS"): "pool-men-r",
    _identity("MEN006R18SS"): "pool-men-r",
    _identity("MEN006S14SS"): "pool-men-s",
    _identity("MEN006S18SS"): "pool-men-s",
    _identity("MEX006SS"): "pool-mex",
    _identity("MH2D006SS"): "pool-mh2d006",
    _identity("MH2D066SS"): "pool-mh2d066",
    _identity("MNO006SS"): "pool-mno",
    _identity("MOA006SS"): "pool-moa",
    _identity("ROC006SS"): "pool-roc",
    _identity("ROT006SS"): "pool-rot",
    _identity("TH2D006SS"): "pool-th2d006",
    _identity("TH2D066SS"): "pool-th2d066",
    _identity("MEN000SS"): "pool-men000",
    _identity("MH2000SS"): "pool-mh2000",
    _identity("RAC00012SS"): "pool-rac00012",
    _identity("TH2000SS"): "pool-th2000",
}


KIT_RELATED_ASSETS: dict[str, list[str]] = {
    _identity("MH2D006SS", "K"): ["pool-mh2d006", "pool-mh2000", "pool-roc"],
    _identity("MH2D066SS", "K"): ["pool-mh2d066", "pool-mh2000", "pool-roc"],
    _identity("TH2D006SS", "K"): ["pool-th2d006", "pool-th2000", "pool-roc"],
    _identity("TH2D066SS", "K"): ["pool-th2d066", "pool-th2000", "pool-roc"],
}


OFFICIAL_WEB_ONLY_ACCESSORY_URLS = {
    "https://sanycces.es/producto/pool-toallero-de-barra-a-pared/",
    "https://sanycces.es/producto/pool-toallero-pared-20/",
    "https://sanycces.es/producto/pool-colgador-_simple/",
    "https://sanycces.es/producto/pool-portarrollo-papel-bano/",
}


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _write_json(path: Path, value: Any) -> None:
    path.write_bytes(_json_bytes(value))


def _write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        raise SanyccesPoolError(f"cannot write empty review table: {path.name}")
    fields = list(rows[0])
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    except (OSError, ValueError) as error:
        raise SanyccesPoolError(f"invalid JSONL input: {path.name}") from error


def _decimal(value: str | None) -> Decimal | None:
    normalized = (value or "").strip()
    if not normalized:
        return None
    try:
        return Decimal(normalized)
    except InvalidOperation as error:
        raise SanyccesPoolError(f"invalid monetary value: {normalized}") from error


def _money(value: Decimal | None) -> str:
    return "" if value is None else format(value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP), "f")


def _discount_percent_for_pvp(pvp_ex_vat: Decimal) -> Decimal:
    if pvp_ex_vat < 0:
        raise SanyccesPoolError("official PVP cannot be negative")
    for upper_exclusive, discount_percent in SANYCCES_DISCOUNT_TIERS:
        if upper_exclusive is None or pvp_ex_vat < upper_exclusive:
            return discount_percent
    raise AssertionError("Sanycces discount tiers must contain an open-ended final tier")


def _sale_price_from_pvp(pvp_ex_vat: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    regular_gross = (pvp_ex_vat * (Decimal(1) + VAT_RATE)).quantize(
        MONEY_QUANTUM, rounding=ROUND_HALF_UP
    )
    discount_percent = _discount_percent_for_pvp(pvp_ex_vat)
    sale_gross = (
        regular_gross * (Decimal(1) - discount_percent / Decimal(100))
    ).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    return regular_gross, discount_percent, sale_gross


def _affirmative(value: str) -> bool:
    return value.strip().casefold() in {"si", "sí"}


def _published_tariff_audit_row(
    woo: dict[str, Any],
    tariff_by_reference: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    reference = woo["sku"]
    tariff_rows: list[dict[str, Any]] = []
    base_reference = reference
    component_references: tuple[str, ...] = ()
    identity_status = "exact_tariff_reference"
    identity_issue = ""

    direct = tariff_by_reference.get(reference)
    if direct is not None:
        tariff_rows = [direct]
    else:
        composite = re.fullmatch(r"(LV307[0-9A-Z]+)(\.(?:TG|T|G))", reference)
        if composite is not None:
            base_reference, suffix = composite.groups()
            component_references = CARDIFF_COMPOSITE_COMPONENTS[suffix]
            expected_tap = suffix in {".G", ".TG"}
            expected_towel_rail = suffix in {".T", ".TG"}
            attributes_match = (
                _affirmative(woo.get("machiningTap", "")) == expected_tap
                and _affirmative(woo.get("machiningTowelRail", "")) == expected_towel_rail
            )
            component_rows = [
                tariff_by_reference.get(item)
                for item in (base_reference, *component_references)
            ]
            if attributes_match and all(item is not None for item in component_rows):
                tariff_rows = [item for item in component_rows if item is not None]
                identity_status = "enki_composite_of_official_tariff_references"
            elif not attributes_match:
                identity_status = "unmapped_published_reference"
                identity_issue = "cardiff_suffix_disagrees_with_machining_attributes"
            else:
                identity_status = "unmapped_published_reference"
                identity_issue = "cardiff_composite_component_missing_from_tariff"
        else:
            identity_status = "unmapped_published_reference"
            identity_issue = "published_reference_missing_from_tariff"

    official_pvp = sum((row["pvpExVat"] for row in tariff_rows), start=Decimal(0)) if tariff_rows else None
    expected_regular = None
    expected_discount = None
    expected_sale = None
    if official_pvp is not None:
        expected_regular, expected_discount, expected_sale = _sale_price_from_pvp(official_pvp)
    regular = _decimal(woo["regularPrice"])
    sale = _decimal(woo["salePrice"])
    regular_delta = None if regular is None or expected_regular is None else regular - expected_regular
    sale_delta = None if sale is None or expected_sale is None else sale - expected_sale
    discount = None
    if regular not in (None, Decimal(0)) and sale is not None:
        discount = ((Decimal(1) - sale / regular) * Decimal(100)).quantize(
            MONEY_QUANTUM, rounding=ROUND_HALF_UP
        )

    if not tariff_rows:
        audit_status = "published_sku_missing_from_tariff"
    elif regular is None:
        audit_status = "published_regular_price_missing"
    elif regular_delta != 0:
        audit_status = "official_tariff_price_mismatch"
    elif identity_status == "exact_tariff_reference":
        audit_status = "exact_official_tariff_match"
    else:
        audit_status = "official_tariff_composite_match"

    return {
        "csvRow": woo["csvRow"],
        "wooId": woo["id"],
        "wooParentId": woo["parentId"],
        "productWooId": woo["id"] if woo["parentId"] in {"", "0"} else woo["parentId"],
        "entityRole": "simple_product" if woo["parentId"] in {"", "0"} else "variation",
        "title": woo["title"],
        "reference": reference,
        "baseReference": base_reference,
        "componentReferences": "|".join(component_references),
        "officialTariffReferences": "|".join(row["reference"] for row in tariff_rows),
        "officialTariffSourceRows": "|".join(str(row["sourceRow"]) for row in tariff_rows),
        "officialTariffPvpExVat": _money(official_pvp),
        "expectedRegularGross21": _money(expected_regular),
        "wooRegularPriceGross": woo["regularPrice"],
        "wooSalePriceGross": woo["salePrice"],
        "regularGrossDelta": _money(regular_delta),
        "discountPercent": "" if discount is None else format(discount, "f"),
        "expectedDiscountPercent": "" if expected_discount is None else format(expected_discount, "f"),
        "expectedSalePriceGross": _money(expected_sale),
        "saleGrossDelta": _money(sale_delta),
        "discountPolicyKey": SANYCCES_DISCOUNT_POLICY_KEY,
        "discountPolicyStatus": (
            "exact_policy_match"
            if sale_delta == 0
            else "sale_price_missing"
            if sale is None
            else "policy_mismatch"
        ),
        "identityStatus": identity_status,
        "identityIssue": identity_issue,
        "tariffComparisonStatus": audit_status,
        "priceErrorConfirmed": audit_status == "official_tariff_price_mismatch",
        "requiresReview": audit_status
        not in {"exact_official_tariff_match", "official_tariff_composite_match"},
    }


def _slugify(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


def _category_for(base_reference: str) -> str:
    for prefix, category in POOL_CATEGORY_BY_PREFIX:
        if base_reference.startswith(prefix):
            return category
    return "Grifos de baño"


def _specification_key(base_reference: str) -> str:
    if base_reference.startswith("MEN006"):
        return "MEN006"
    if base_reference.startswith("MH2D"):
        return "MH2D"
    if base_reference.startswith("TH2D"):
        return "TH2D"
    return base_reference


def _technical_highlights(base_reference: str, configuration_tail: str) -> list[str]:
    if configuration_tail == "K":
        prefix = "Termostático" if base_reference.startswith("TH") else "Monomando"
        body = [
            f"{prefix} de ducha mural horizontal Pool",
            "Cuerpo de encastre Sanybox Inox correspondiente",
            "Rociador de ducha mural Pool",
        ]
        return body
    return list(POOL_TECHNICAL_HIGHLIGHTS.get(_specification_key(base_reference), []))


def _seo(title: str) -> dict[str, str]:
    concise = title
    for source, target in (
        ("Monomando de ", "Monomando "),
        ("Termostático de ", "Termostático "),
        ("Rociador de ", "Rociador "),
        ("Grifería de ", "Grifería "),
        (", caño de ", " "),
        (", versión ", " "),
    ):
        concise = concise.replace(source, target)
    keyword = concise.lower()
    seo_title = f"{concise} | Sanycces"
    meta = f"{title}. Acero inoxidable 316L. Consulta acabados y ficha técnica de Sanycces."
    if len(seo_title) > 70 or len(meta) > 155:
        raise SanyccesPoolError(f"reviewed Pool SEO copy exceeds its limit: {title}")
    return {"focusKeyword": keyword, "title": seo_title, "metaDescription": meta}


def _article_copy(
    title: str,
    highlights: list[str],
    *,
    component: bool,
) -> tuple[str, str]:
    if component:
        short = f"{title}, componente técnico de la colección Pool de Sanycces para instalaciones compatibles."
    else:
        short = f"{title} de Sanycces en acero inoxidable 316L, disponible en níquel cepillado y Raw Metal."
    paragraphs = [
        f"<p>{html.escape(short)}</p>",
        "<p>La colección Pool combina geometrías redondeadas, acero inoxidable 316L y soluciones pensadas "
        "para integrar la grifería en baños contemporáneos.</p>",
    ]
    if highlights:
        paragraphs.append("<h2>Características técnicas</h2><ul>" + "".join(
            f"<li>{html.escape(item)}</li>" for item in highlights
        ) + "</ul>")
    return f"<p>{html.escape(short)}</p>", "".join(paragraphs)


def parse_official_pool_listing(path: Path) -> list[dict[str, str]]:
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        raise SanyccesPoolError("official Pool listing could not be read") from error
    pattern = re.compile(
        r'<a href="([^"]+)" class="producto-item ([^"]*\bpool\b[^"]*)">(.*?)</a>',
        re.DOTALL,
    )
    rows: list[dict[str, str]] = []
    for url, classes, body in pattern.findall(source):
        title_match = re.search(r"<h3>(.*?)</h3>", body, re.DOTALL)
        image_match = re.search(
            r"--background-image\s*:\s*url\(['\"]?([^'\")]+)",
            body,
        )
        if image_match is None:
            image_match = re.search(r"(?:data-bg|style)=\"[^\"]*?url\(['\"]?([^'\")]+)", body)
        if title_match is None or image_match is None:
            continue
        title = html.unescape(re.sub(r"<[^>]+>", " ", title_match.group(1)))
        rows.append(
            {
                "url": url,
                "title": re.sub(r"\s+", " ", title).strip(),
                "imageUrl": html.unescape(image_match.group(1)),
                "classes": re.sub(r"\s+", " ", classes).strip(),
            }
        )
    if len(rows) != POOL_EXPECTED_OFFICIAL_CARDS or len({item["url"] for item in rows}) != len(rows):
        raise SanyccesPoolError("official Pool listing cardinality drift")
    return rows


def _read_woo_rows(path: Path, adapter: dict[str, Any]) -> list[dict[str, Any]]:
    read_woo_snapshot(path, adapter)
    encoding = str(adapter["wooSnapshot"]["encoding"])
    delimiter = str(adapter["wooSnapshot"]["delimiter"])
    try:
        with path.open("r", encoding=encoding, newline="") as handle:
            rows = list(csv.reader(handle, delimiter=delimiter))
    except (OSError, UnicodeError, csv.Error) as error:
        raise SanyccesPoolError("Woo export could not be parsed") from error
    headers, data = rows[0], rows[1:]
    expected_headers = {
        0: "ID",
        1: "Title",
        6: "Permalink",
        7: "Parent Product ID",
        8: "Sku",
        10: "Price",
        11: "Regular Price",
        12: "Sale Price",
        13: "Stock Status",
        23: "Attribute Value (pa_acabado)",
        303: "Attribute Value (pa_seriessanycess)",
        332: "Attribute Name (Mecanizado-para-griferia)",
        337: "Attribute Name (Mecanizado-para-toallero)",
        347: "Product Type",
        358: "Categorías del producto",
        359: "Product Tags",
        362: "Status",
        368: "Slug",
        397: "Tax Status",
        398: "Tax Class",
        436: "_yoast_wpseo_title",
        437: "_yoast_wpseo_metadesc",
        438: "_yoast_wpseo_focuskw",
        450: "_enki_source_refs",
        451: "_enki_price_basis_note",
        453: "_enki_source_page",
        454: "_enki_pdf_pvp_sin_iva",
        455: "_enki_regular_price_includes_vat",
    }
    if any(headers[index] != name for index, name in expected_headers.items()):
        raise SanyccesPoolError("Woo positional fields drifted")
    return [
        {
            "csvRow": index,
            "id": row[0].strip(),
            "title": row[1].strip(),
            "permalink": row[6].strip(),
            "parentId": row[7].strip(),
            "sku": row[8].strip().upper(),
            "price": row[10].strip(),
            "regularPrice": row[11].strip(),
            "salePrice": row[12].strip(),
            "stockStatus": row[13].strip(),
            "finish": row[23].strip(),
            "series": row[303].strip(),
            "machiningTap": row[333].strip(),
            "machiningTowelRail": row[338].strip(),
            "productType": row[347].strip(),
            "categories": row[358].strip(),
            "tags": row[359].strip(),
            "status": row[362].strip(),
            "slug": row[368].strip(),
            "taxStatus": row[397].strip(),
            "taxClass": row[398].strip(),
            "seoTitle": row[436].strip(),
            "seoDescription": row[437].strip(),
            "seoFocusKeyword": row[438].strip(),
            "sourceRefs": row[450].strip(),
            "priceBasisNote": row[451].strip(),
            "sourcePage": row[453].strip(),
            "pdfPvpExVat": row[454].strip(),
            "regularPriceIncludesVat": row[455].strip(),
        }
        for index, row in enumerate(data, start=2)
    ]


def _read_live_store_pages(paths: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        try:
            page = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise SanyccesPoolError("live Store API snapshot is invalid") from error
        if not isinstance(page, list):
            raise SanyccesPoolError("live Store API page must be a JSON array")
        rows.extend(page)
    ids = [str(item.get("id", "")) for item in rows]
    if not rows or len(ids) != len(set(ids)):
        raise SanyccesPoolError("live Store API snapshot must contain unique products")
    if any(
        not any(str(brand.get("slug", "")).lower() == "sanycces" for brand in item.get("brands", []))
        for item in rows
    ):
        raise SanyccesPoolError("live Store API snapshot contains a non-Sanycces product")
    return rows


def _read_direct_checks(path: Path) -> list[dict[str, Any]]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise SanyccesPoolError("direct public-page checks are invalid") from error
    if document.get("schema") != "enki-public-page-checks/v1":
        raise SanyccesPoolError("unexpected direct public-page check schema")
    checks = document.get("checks")
    if not isinstance(checks, list) or any(item.get("httpStatus") != 200 for item in checks):
        raise SanyccesPoolError("direct public-page checks must all be HTTP 200")
    return checks


def _scan_pdf_price_signals(path: Path) -> dict[str, Any]:
    labels = {"pvp", "precio", "price", "iva", "vat", "eur"}
    found: list[dict[str, Any]] = []
    decimal_tokens = 0
    decimal_pattern = re.compile(r"\d+[.,]\d+")
    try:
        with pdfplumber.open(path) as document:
            for physical_page, page in enumerate(document.pages, start=1):
                words = page.extract_words(
                    x_tolerance=3,
                    y_tolerance=3,
                    keep_blank_chars=False,
                    use_text_flow=False,
                )
                for word in words:
                    token = str(word.get("text", "")).strip()
                    if decimal_pattern.search(token):
                        decimal_tokens += 1
                    normalized = token.casefold().strip(".:;,-")
                    if "€" in token or normalized in labels:
                        found.append({"physicalPage": physical_page, "token": token})
    except Exception as error:
        raise SanyccesPoolError("PDF price-signal scan failed") from error
    return {
        "method": "full_pdf_word_scan_for_currency_or_explicit_price_labels",
        "physicalPages": physical_page,
        "explicitPriceSignalCount": len(found),
        "explicitPriceSignals": found,
        "decimalTokenCount": decimal_tokens,
        "interpretation": (
            "no_auditable_prices_in_attached_pdf"
            if not found
            else "explicit_price_signals_require_manual_review"
        ),
        "decimalTokenNote": "Los decimales sin señal monetaria son cotas o especificaciones técnicas y no se tratan como precios.",
    }


def _store_money(product: dict[str, Any], key: str) -> Decimal | None:
    prices = product.get("prices", {})
    raw = prices.get(key)
    if raw in (None, ""):
        return None
    minor = int(prices.get("currency_minor_unit", 2))
    return Decimal(str(raw)) / (Decimal(10) ** minor)


def _minimum(rows: list[dict[str, Any]], field: str) -> Decimal | None:
    values = [_decimal(str(row.get(field, ""))) for row in rows]
    present = [value for value in values if value is not None]
    return min(present) if present else None


def _price_row(
    store: dict[str, Any],
    parent: dict[str, Any],
    children: list[dict[str, Any]],
) -> dict[str, Any]:
    commercial_rows = children if store.get("type") == "variable" else [parent]
    export_current = _minimum(commercial_rows, "price")
    export_regular = _minimum(commercial_rows, "regularPrice")
    export_sale = _minimum(commercial_rows, "salePrice")
    live_current = _store_money(store, "price")
    live_regular = _store_money(store, "regular_price")
    live_sale = _store_money(store, "sale_price")
    membership_live = {str(item.get("id")) for item in store.get("variations", [])}
    membership_export = {str(item["id"]) for item in children}
    prices_match = (live_current, live_regular, live_sale) == (
        export_current,
        export_regular,
        export_sale,
    )
    membership_matches = membership_live == membership_export
    discount = None
    if live_regular not in (None, Decimal(0)) and live_sale is not None:
        discount = ((Decimal(1) - (live_sale / live_regular)) * Decimal(100)).quantize(
            MONEY_QUANTUM, rounding=ROUND_HALF_UP
        )
    derived_net = None
    net_exact_to_cent = False
    if live_regular is not None:
        unrounded = live_regular / (Decimal(1) + VAT_RATE)
        derived_net = unrounded.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        net_exact_to_cent = abs(unrounded - derived_net) < Decimal("0.000001")
    return {
        "wooId": parent["id"],
        "title": parent["title"],
        "sku": parent["sku"],
        "permalink": parent["permalink"],
        "productType": parent["productType"],
        "variationCount": len(children),
        "liveCurrentPriceGross": _money(live_current),
        "liveRegularPriceGross": _money(live_regular),
        "liveSalePriceGross": _money(live_sale),
        "exportCurrentPriceGross": _money(export_current),
        "exportRegularPriceGross": _money(export_regular),
        "exportSalePriceGross": _money(export_sale),
        "derivedRegularPvpExVat21": _money(derived_net),
        "derivedNetIsExactToCent": net_exact_to_cent,
        "discountPercent": "" if discount is None else format(discount, "f"),
        "pricesMatchLiveVsExport": prices_match,
        "variationMembershipMatches": membership_matches,
        "auditStatus": "exact_live_export_match" if prices_match and membership_matches else "mismatch",
        "pdfPriceStatus": "not_available_in_attached_pdf",
    }


def _catalog_scope(categories: str) -> bool:
    return any(value in categories for value in ("Grifos de baño", "Fontanería", "Accesorios de baño"))


def _finish_names(references: list[str]) -> list[str]:
    result: list[str] = []
    if any(re.search(r"NB(?:K)?$", reference) for reference in references):
        result.append("Níquel cepillado (NB)")
    if any(re.search(r"RM(?:K)?$", reference) for reference in references):
        result.append("Raw Metal (RM)")
    return result


def _all_group_references(group: dict[str, Any]) -> list[str]:
    return sorted(
        reference
        for status in ("existing", "not_in_export", "needs_review")
        for reference in group["references"][status]
    )


def _prepare_official_media(
    workspace: DataWorkspace,
    run_directory: Path,
    listing: list[dict[str, str]],
    *,
    rights_confirmed: bool,
) -> dict[str, dict[str, Any]]:
    if rights_confirmed is not True:
        raise SanyccesPoolError("official Pool media requires explicit rights confirmation")
    by_url = {item["url"]: item for item in listing}
    profile = load_media_profile(workspace.files["profile"])
    media_directory = run_directory / "media"
    media_directory.mkdir(mode=0o750)
    results: dict[str, dict[str, Any]] = {}
    for asset_key, definition in sorted(OFFICIAL_ASSETS.items()):
        listing_item = by_url.get(definition["url"])
        if listing_item is None:
            raise SanyccesPoolError(f"official Pool asset URL disappeared: {definition['url']}")
        source = workspace.input_root / "official-images" / definition["file"]
        try:
            resolved = source.resolve(strict=True)
        except OSError as error:
            raise SanyccesPoolError(f"official image is missing: {definition['file']}") from error
        if source.is_symlink() or not resolved.is_file() or not resolved.is_relative_to(workspace.input_root):
            raise SanyccesPoolError("official image must be a regular file inside the clean input root")
        target = media_directory / f"{asset_key}.webp"
        rendered = render_product_media_candidate(resolved, target, profile)
        results[asset_key] = {
            "assetKey": asset_key,
            "officialProductUrl": definition["url"],
            "sourceUrl": listing_item["imageUrl"],
            "sourcePath": resolved.relative_to(workspace.input_root).as_posix(),
            "sourceSha256": sha256_file(resolved),
            "sourceMimeType": rendered["sourceMimeType"],
            "sourceWidth": rendered["sourceWidth"],
            "sourceHeight": rendered["sourceHeight"],
            "rightsConfirmed": True,
            "outputPath": f"media/{asset_key}.webp",
            "outputSha256": sha256_file(target),
            "outputMimeType": "image/webp",
            "outputWidth": rendered["outputWidth"],
            "outputHeight": rendered["outputHeight"],
            "contentWidth": rendered["contentWidth"],
            "contentHeight": rendered["contentHeight"],
            "metadataStripped": rendered["metadataStripped"],
            "upscaled": rendered["upscaled"],
            "sizeBytes": rendered["sizeBytes"],
            "profileKey": profile["profileKey"],
            "profileSha256": sha256_file(workspace.files["profile"]),
            "approvalState": "prepared_candidate_needs_product_review",
        }
    return results


def _pool_article_record(
    group: dict[str, Any],
    media: dict[str, dict[str, Any]],
    pdf_sha256: str,
    tariff_by_reference: dict[str, dict[str, Any]],
    tariff_sha256: str,
) -> dict[str, Any]:
    base = str(group["baseReference"])
    tail = str(group["configurationTail"])
    key = _identity(base, tail)
    title = POOL_TITLES.get(key)
    if title is None:
        raise SanyccesPoolError(f"Pool title mapping is missing for {key}")
    references = _all_group_references(group)
    highlights = _technical_highlights(base, tail)
    component = group["entityRole"] == "component"
    short_html, description_html = _article_copy(
        title,
        highlights,
        component=component,
    )
    asset_key = GROUP_ASSET_KEYS.get(key)
    related_asset_keys = KIT_RELATED_ASSETS.get(key, [])
    media_status = "dedicated_official_webp_prepared" if asset_key else "kit_hero_not_available"
    price_variants: list[dict[str, Any]] = []
    for reference in references:
        tariff = tariff_by_reference.get(reference)
        if tariff is None or tariff["pvpExVat"] <= 0:
            raise SanyccesPoolError(f"Pool reference lacks a positive official tariff PVP: {reference}")
        regular_gross, discount_percent, sale_gross = _sale_price_from_pvp(
            tariff["pvpExVat"]
        )
        price_variants.append(
            {
                "reference": reference,
                "ean": tariff["ean"],
                "eanStatus": tariff["eanStatus"],
                "tariffSourceRow": tariff["sourceRow"],
                "officialPvpExVat": _money(tariff["pvpExVat"]),
                "expectedRegularGross21": _money(regular_gross),
                "discountPercent": format(discount_percent, "f"),
                "salePriceGross": _money(sale_gross),
                "discountPolicyKey": SANYCCES_DISCOUNT_POLICY_KEY,
                "discountStatus": "derived_from_approved_sanycces_price_tier_policy",
            }
        )
    blockers: list[str] = []
    if asset_key is None:
        blockers.append("dedicated_kit_hero_required")
    mapped = media.get(asset_key) if asset_key else None
    official_url = mapped["officialProductUrl"] if mapped else None
    return {
        "schema": "enki-sanycces-pool-article/v1",
        "groupKey": group["groupKey"],
        "identity": key,
        "baseReference": base,
        "configurationTail": tail,
        "entityRole": group["entityRole"],
        "articleKind": "component_record" if component else "product_article",
        "title": title,
        "slug": _slugify(title),
        "brand": "Sanycces",
        "series": "Pool",
        "recommendedCategory": "Fontanería > Sanybox" if component else _category_for(base),
        "productModelRecommendation": "simple" if component else "variable_by_finish",
        "merchandisingDecision": (
            "standalone_sellable_sanybox_product_approved"
            if component
            else "sellable_product"
        ),
        "references": references,
        "finishes": _finish_names(references),
        "shortDescriptionHtml": short_html,
        "descriptionHtml": description_html,
        "technicalHighlights": highlights,
        "seo": _seo(title),
        "pdfEvidence": {
            "sourceSha256": pdf_sha256,
            "printedPages": group["printedPages"],
            "nearbyTitles": group["nearbyTitles"],
            "inventoryAuthority": "official_pdf",
        },
        "officialEnrichment": {
            "productUrl": official_url,
            "inventoryAuthority": False,
            "mappingStatus": "reviewed_mapping" if official_url else "no_standalone_official_kit_page",
        },
        "media": {
            "status": media_status,
            "primary": mapped,
            "relatedAssetKeys": related_asset_keys,
            "alt": f"{title} de Sanycces, colección Pool" if mapped else None,
        },
        "pricing": {
            "officialTariffSha256": tariff_sha256,
            "officialTariffKey": "PVPNA",
            "vatRate": "21.00",
            "variants": price_variants,
            "discountPolicyKey": SANYCCES_DISCOUNT_POLICY_KEY,
            "status": "official_tariff_and_discount_policy_complete",
            "note": (
                "El PVP oficial sin IVA se toma de PVP_NACIONAL_2026; el precio regular bruto se calcula al 21 %. "
                "El precio rebajado aplica la política por tramos observada en las 1.217 referencias publicadas "
                "y aprobada para nuevas altas Sanycces."
            ),
        },
        "publication": {
            "currentExactSkuState": "absent_from_export",
            "contentStatus": "prepared_for_review",
            "publishAuthorized": False,
            "draftAuthorized": False,
            "blockers": blockers,
        },
    }


def _article_csv_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in records:
        primary = item["media"]["primary"] or {}
        rows.append(
            {
                "identity": item["identity"],
                "base_reference": item["baseReference"],
                "configuration_tail": item["configurationTail"],
                "entity_role": item["entityRole"],
                "article_kind": item["articleKind"],
                "title": item["title"],
                "slug": item["slug"],
                "recommended_category": item["recommendedCategory"],
                "product_model": item["productModelRecommendation"],
                "references": "|".join(item["references"]),
                "finishes": "|".join(item["finishes"]),
                "printed_pages": "|".join(str(page) for page in item["pdfEvidence"]["printedPages"]),
                "official_url": item["officialEnrichment"]["productUrl"] or "",
                "media_status": item["media"]["status"],
                "webp_path": primary.get("outputPath", ""),
                "webp_sha256": primary.get("outputSha256", ""),
                "seo_title": item["seo"]["title"],
                "seo_meta_description": item["seo"]["metaDescription"],
                "seo_focus_keyword": item["seo"]["focusKeyword"],
                "official_pvp_sin_iva": "|".join(
                    f"{variant['reference']}={variant['officialPvpExVat']}"
                    for variant in item["pricing"]["variants"]
                ),
                "expected_regular_gross_21": "|".join(
                    f"{variant['reference']}={variant['expectedRegularGross21']}"
                    for variant in item["pricing"]["variants"]
                ),
                "discount_percent": "|".join(
                    f"{variant['reference']}={variant['discountPercent']}"
                    for variant in item["pricing"]["variants"]
                ),
                "sale_price_gross": "|".join(
                    f"{variant['reference']}={variant['salePriceGross']}"
                    for variant in item["pricing"]["variants"]
                ),
                "discount_policy_key": item["pricing"]["discountPolicyKey"],
                "price_status": item["pricing"]["status"],
                "content_status": item["publication"]["contentStatus"],
                "publish_authorized": "no",
                "blockers": "|".join(item["publication"]["blockers"]),
            }
        )
    return rows


def _artifact_manifest(run_directory: Path, source_rows: list[dict[str, Any]]) -> dict[str, Any]:
    artifacts = []
    for path in sorted(item for item in run_directory.rglob("*") if item.is_file() and item.name != "artifact-manifest.json"):
        artifacts.append(
            {
                "path": path.relative_to(run_directory).as_posix(),
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    return {
        "schema": "enki-artifact-manifest/v1",
        "runtimeVersion": PIPELINE_VERSION,
        "sources": source_rows,
        "artifacts": artifacts,
    }


def prepare_sanycces_pool(
    workspace: DataWorkspace,
    *,
    run_id: str,
    rights_confirmed: bool,
) -> dict[str, Any]:
    run_id = validate_run_id(run_id)
    adapter, adapter_sha256 = load_sanycces_adapter()
    analysis = json.loads(workspace.files["analysis"].read_text(encoding="utf-8"))
    if analysis.get("schema") != ANALYSIS_SCHEMA or analysis.get("poolDoubleCheck", {}).get("status") != "verified":
        raise SanyccesPoolError("input analysis is not the verified Sanycces catalogue analysis")
    pdf_sha256 = sha256_file(workspace.files["pdf"])
    if pdf_sha256 != adapter["source"]["pdfSha256"]:
        raise SanyccesAnalysisError("Sanycces PDF fingerprint does not match the reviewed adapter")
    woo_rows = _read_woo_rows(workspace.files["woo"], adapter)
    groups = _read_jsonl(workspace.files["groups"])
    candidates = _read_jsonl(workspace.files["candidates"])
    official_listing = parse_official_pool_listing(workspace.files["official_listing"])
    live_products = _read_live_store_pages([workspace.files["live_page_1"], workspace.files["live_page_2"]])
    direct_checks = _read_direct_checks(workspace.files["direct_checks"])
    tariff = read_sanycces_price_tariff(workspace.files["tariff"])
    tariff_sha256 = sha256_file(workspace.files["tariff"])
    tariff_by_reference = {record["reference"]: record for record in tariff["records"]}
    price_scan = _scan_pdf_price_signals(workspace.files["pdf"])
    if price_scan["explicitPriceSignalCount"] != 0:
        raise SanyccesPoolError("attached PDF now contains explicit price signals and requires a reviewed price parser")

    run_directory = workspace.output_root / run_id
    try:
        run_directory.mkdir(mode=0o750)
    except FileExistsError as error:
        raise SanyccesPoolError("refusing to overwrite an existing Pool preparation run") from error
    except OSError as error:
        raise SanyccesPoolError("could not create Pool preparation run") from error

    try:
        official_media = _prepare_official_media(
            workspace,
            run_directory,
            official_listing,
            rights_confirmed=rights_confirmed,
        )
        pool_groups = sorted(
            (
                item
                for item in groups
                if "pool" in item.get("sections", []) and item["groupStatus"] != "excluded_context"
            ),
            key=lambda item: (item["baseReference"], item["configurationTail"]),
        )
        if len(pool_groups) != POOL_EXPECTED_INVENTORY_GROUPS:
            raise SanyccesPoolError("Pool inventory group count drift")
        pool_candidates = [item for item in candidates if "pool" in item.get("sections", [])]
        pool_context_references = [
            item["reference"] for item in pool_candidates if item["comparisonStatus"] == "excluded_context"
        ]
        if len(pool_candidates) != 54 or len(pool_context_references) != 2:
            raise SanyccesPoolError("Pool reviewed reference count drift")
        identities = {_identity(item["baseReference"], item["configurationTail"]) for item in pool_groups}
        if identities != set(POOL_TITLES):
            raise SanyccesPoolError("Pool reviewed title map no longer covers the exact PDF inventory")
        articles = [
            _pool_article_record(
                item,
                official_media,
                pdf_sha256,
                tariff_by_reference,
                tariff_sha256,
            )
            for item in pool_groups
        ]
        if sum(item["articleKind"] == "product_article" for item in articles) != POOL_EXPECTED_PRODUCT_CANDIDATES:
            raise SanyccesPoolError("Pool product-candidate count drift")
        if sum(item["articleKind"] == "component_record" for item in articles) != POOL_EXPECTED_COMPONENTS:
            raise SanyccesPoolError("Pool component count drift")

        woo_by_sku = {item["sku"]: item for item in woo_rows if item["sku"]}
        woo_by_id = {item["id"]: item for item in woo_rows}
        children_by_parent: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in woo_rows:
            children_by_parent[row["parentId"]].append(row)

        inventory_groups = [item for item in groups if item["groupStatus"] != "excluded_context"]
        group_audit: list[dict[str, Any]] = []
        reference_audit: list[dict[str, Any]] = []
        pdf_inventory_references: set[str] = set()
        for group in inventory_groups:
            references = _all_group_references(group)
            pdf_inventory_references.update(references)
            states: list[str] = []
            for reference in references:
                row = woo_by_sku.get(reference)
                tariff_row = tariff_by_reference.get(reference)
                if tariff_row is None or tariff_row["pvpExVat"] <= 0:
                    raise SanyccesPoolError(
                        f"PDF inventory reference lacks a positive official tariff PVP: {reference}"
                    )
                state = "absent_from_export" if row is None else f"export_{row['status']}"
                states.append(state)
                reference_audit.append(
                    {
                        "reference": reference,
                        "groupIdentity": _identity(group["baseReference"], group["configurationTail"]),
                        "baseReference": group["baseReference"],
                        "configurationTail": group["configurationTail"],
                        "entityRole": group["entityRole"],
                        "sections": "|".join(group["sections"]),
                        "printedPages": "|".join(str(page) for page in group["printedPages"]),
                        "publicationState": state,
                        "wooId": "" if row is None else row["id"],
                        "wooParentId": "" if row is None else row["parentId"],
                        "wooStatus": "" if row is None else row["status"],
                        "wooRegularPriceGross": "" if row is None else row["regularPrice"],
                        "wooSalePriceGross": "" if row is None else row["salePrice"],
                        "officialTariffSourceRow": tariff_row["sourceRow"],
                        "officialTariffPvpExVat": _money(tariff_row["pvpExVat"]),
                        "expectedRegularGross21": _money(
                            tariff_row["pvpExVat"] * (Decimal(1) + VAT_RATE)
                        ),
                        "tariffEan": tariff_row["ean"],
                        "tariffEanStatus": tariff_row["eanStatus"],
                        "priceAuditStatus": (
                            "official_tariff_available_pending_web_comparison"
                            if state == "export_publish"
                            else "official_tariff_available_not_published"
                        ),
                    }
                )
            if states and all(state == "export_publish" for state in states):
                group_state = "fully_published"
            elif "export_publish" in states:
                group_state = "partially_published"
            elif states and all(state == "absent_from_export" for state in states):
                group_state = "absent_from_export"
            elif "export_private" in states:
                group_state = "private_or_private_plus_missing"
            else:
                group_state = "needs_review"
            group_audit.append(
                {
                    "groupIdentity": _identity(group["baseReference"], group["configurationTail"]),
                    "baseReference": group["baseReference"],
                    "configurationTail": group["configurationTail"],
                    "entityRole": group["entityRole"],
                    "sections": "|".join(group["sections"]),
                    "printedPages": "|".join(str(page) for page in group["printedPages"]),
                    "referenceCount": len(references),
                    "publishedReferences": "|".join(ref for ref, state in zip(references, states, strict=True) if state == "export_publish"),
                    "privateReferences": "|".join(ref for ref, state in zip(references, states, strict=True) if state == "export_private"),
                    "missingReferences": "|".join(ref for ref, state in zip(references, states, strict=True) if state == "absent_from_export"),
                    "publicationState": group_state,
                }
            )

        live_by_id = {str(item["id"]): item for item in live_products}
        live_price_rows: list[dict[str, Any]] = []
        for woo_id, store in sorted(live_by_id.items(), key=lambda item: int(item[0])):
            parent = woo_by_id.get(woo_id)
            if parent is None or parent["status"] != "publish" or parent["parentId"] not in {"", "0"}:
                raise SanyccesPoolError("live Store API product does not match a published export parent")
            live_price_rows.append(_price_row(store, parent, children_by_parent[woo_id]))
        if any(item["auditStatus"] != "exact_live_export_match" for item in live_price_rows):
            raise SanyccesPoolError("live Store API price or variation mismatch detected")

        published_commercial_rows = sorted(
            (
                item
                for item in woo_rows
                if item["status"] == "publish"
                and item["sku"]
                and (item["parentId"] not in {"", "0"} or item["productType"] == "simple")
            ),
            key=lambda item: (
                int(item["id"] if item["parentId"] in {"", "0"} else item["parentId"]),
                int(item["id"]),
            ),
        )
        published_commercial_references = [item["sku"] for item in published_commercial_rows]
        if len(published_commercial_references) != len(set(published_commercial_references)):
            raise SanyccesPoolError("published commercial Sanycces SKUs must be unique")
        published_tariff_audit = [
            _published_tariff_audit_row(item, tariff_by_reference)
            for item in published_commercial_rows
        ]
        if any(
            item["discountPolicyStatus"] != "exact_policy_match"
            for item in published_tariff_audit
        ):
            raise SanyccesPoolError(
                "published Sanycces sale price drifted from the approved discount policy"
            )
        tariff_audit_by_product: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in published_tariff_audit:
            tariff_audit_by_product[item["productWooId"]].append(item)
        used_as_composite_components = {
            reference
            for item in published_tariff_audit
            if item["identityStatus"] == "enki_composite_of_official_tariff_references"
            for reference in item["componentReferences"].split("|")
            if reference
        }
        exact_published_tariff_references = {
            item["reference"]
            for item in published_tariff_audit
            if item["identityStatus"] == "exact_tariff_reference"
        }
        tariff_not_published_audit = [
            {
                "officialTariffSourceRow": item["sourceRow"],
                "reference": item["reference"],
                "description": item["description"],
                "officialTariffPvpExVat": _money(item["pvpExVat"]),
                "expectedRegularGross21": _money(
                    item["pvpExVat"] * (Decimal(1) + VAT_RATE)
                ),
                "ean": item["ean"],
                "eanStatus": item["eanStatus"],
                "publishedRepresentationStatus": (
                    "used_as_composite_component"
                    if item["reference"] in used_as_composite_components
                    else "not_represented_by_published_commercial_sku"
                ),
            }
            for item in tariff["records"]
            if item["reference"] not in exact_published_tariff_references
        ]

        direct_by_url = {item["url"]: item for item in direct_checks}
        published_parents = sorted(
            (
                item
                for item in woo_rows
                if item["status"] == "publish" and item["parentId"] in {"", "0"}
            ),
            key=lambda item: int(item["id"]),
        )
        published_crosswalk: list[dict[str, Any]] = []
        for parent in published_parents:
            members = [parent, *children_by_parent[parent["id"]]]
            tariff_rows = tariff_audit_by_product[parent["id"]]
            tariff_statuses = Counter(item["tariffComparisonStatus"] for item in tariff_rows)
            exact_references = sorted(
                {member["sku"] for member in members if member["sku"] in pdf_inventory_references}
            )
            if exact_references:
                scope_state = "matched_pdf_exact"
            elif _catalog_scope(parent["categories"]):
                scope_state = "in_scope_no_exact_pdf_reference"
            else:
                scope_state = "outside_attached_griferia_pdf_scope"
            store = live_by_id.get(parent["id"])
            direct = direct_by_url.get(parent["permalink"])
            public_state = "store_api_public" if store else "direct_http_200" if direct else "not_verified_public"
            published_crosswalk.append(
                {
                    "wooId": parent["id"],
                    "title": parent["title"],
                    "sku": parent["sku"],
                    "permalink": parent["permalink"],
                    "categories": parent["categories"],
                    "productType": parent["productType"],
                    "variationCount": len(children_by_parent[parent["id"]]),
                    "sellableSkuCount": len(tariff_rows),
                    "exactTariffSkuCount": tariff_statuses["exact_official_tariff_match"],
                    "compositeTariffSkuCount": tariff_statuses["official_tariff_composite_match"],
                    "missingTariffSkuCount": tariff_statuses["published_sku_missing_from_tariff"],
                    "tariffPriceMismatchCount": tariff_statuses["official_tariff_price_mismatch"],
                    "tariffCoverageStatus": (
                        "all_sellable_skus_match_official_tariff"
                        if tariff_rows
                        and not any(item["requiresReview"] for item in tariff_rows)
                        else "tariff_review_required"
                    ),
                    "parentSkuRole": (
                        "local_variable_parent_identifier"
                        if parent["productType"] == "variable"
                        else "commercial_sku"
                    ),
                    "publicVerification": public_state,
                    "catalogScopeState": scope_state,
                    "exactPdfReferences": "|".join(exact_references),
                    "reviewDisposition": (
                        "covered_by_attached_pdf"
                        if scope_state == "matched_pdf_exact"
                        else "not_assessable_from_attached_griferia_pdf_other_catalogue_required"
                        if scope_state == "in_scope_no_exact_pdf_reference"
                        else "do_not_count_as_extra_this_pdf_is_out_of_scope"
                    ),
                }
            )
        if any(item["publicVerification"] == "not_verified_public" for item in published_crosswalk):
            raise SanyccesPoolError("one or more published export parents lack public verification")

        price_audit: list[dict[str, Any]] = []
        for reference_row in reference_audit:
            if reference_row["publicationState"] != "export_publish":
                continue
            woo = woo_by_sku[reference_row["reference"]]
            tariff_row = tariff_by_reference[reference_row["reference"]]
            regular = _decimal(woo["regularPrice"])
            sale = _decimal(woo["salePrice"])
            expected_regular = (
                tariff_row["pvpExVat"] * (Decimal(1) + VAT_RATE)
            ).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
            derived_net = None
            exact_net = False
            discount = None
            regular_delta = None if regular is None else regular - expected_regular
            regular_matches_tariff = regular_delta == Decimal(0)
            if regular is not None:
                unrounded = regular / (Decimal(1) + VAT_RATE)
                derived_net = unrounded.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
                exact_net = abs(unrounded - derived_net) < Decimal("0.000001")
            if regular not in (None, Decimal(0)) and sale is not None:
                discount = ((Decimal(1) - sale / regular) * Decimal(100)).quantize(
                    MONEY_QUANTUM, rounding=ROUND_HALF_UP
                )
            price_audit.append(
                {
                    "reference": reference_row["reference"],
                    "groupIdentity": reference_row["groupIdentity"],
                    "sections": reference_row["sections"],
                    "wooId": woo["id"],
                    "wooParentId": woo["parentId"],
                    "officialTariffSourceRow": tariff_row["sourceRow"],
                    "officialTariffPvpExVat": _money(tariff_row["pvpExVat"]),
                    "expectedRegularGross21": _money(expected_regular),
                    "wooRegularPriceGross": woo["regularPrice"],
                    "wooSalePriceGross": woo["salePrice"],
                    "regularGrossDelta": _money(regular_delta),
                    "regularMatchesOfficialTariff": regular_matches_tariff,
                    "derivedRegularPvpExVat21": _money(derived_net),
                    "derivedNetIsExactToCent": exact_net,
                    "discountPercent": "" if discount is None else format(discount, "f"),
                    "tariffComparisonStatus": (
                        "exact_official_tariff_match"
                        if regular_matches_tariff
                        else "official_tariff_mismatch"
                    ),
                    "priceErrorConfirmed": not regular_matches_tariff,
                }
            )

        pool_price_audit = [
            {
                "reference": row["reference"],
                "groupIdentity": row["groupIdentity"],
                "entityRole": row["entityRole"],
                "publicationState": row["publicationState"],
                "officialTariffSourceRow": row["officialTariffSourceRow"],
                "officialTariffPvpExVat": row["officialTariffPvpExVat"],
                "expectedRegularGross21": row["expectedRegularGross21"],
                "discountPercent": format(
                    _sale_price_from_pvp(
                        tariff_by_reference[row["reference"]]["pvpExVat"]
                    )[1],
                    "f",
                ),
                "salePriceGross": _money(
                    _sale_price_from_pvp(
                        tariff_by_reference[row["reference"]]["pvpExVat"]
                    )[2]
                ),
                "discountPolicyKey": SANYCCES_DISCOUNT_POLICY_KEY,
                "discountStatus": "derived_from_approved_sanycces_price_tier_policy",
                "tariffEan": row["tariffEan"],
                "tariffEanStatus": row["tariffEanStatus"],
            }
            for row in reference_audit
            if row["sections"] == "pool"
        ]
        if len(pool_price_audit) != 52:
            raise SanyccesPoolError("Pool price audit reference count drift")

        official_by_url = {item["url"]: item for item in official_listing}
        official_crosswalk: list[dict[str, Any]] = []
        groups_by_asset: defaultdict[str, list[str]] = defaultdict(list)
        for group_key, asset_key in GROUP_ASSET_KEYS.items():
            groups_by_asset[asset_key].append(group_key)
        for asset_key, definition in sorted(OFFICIAL_ASSETS.items()):
            official = official_by_url[definition["url"]]
            official_crosswalk.append(
                {
                    "officialTitle": official["title"],
                    "officialUrl": official["url"],
                    "officialImageUrl": official["imageUrl"],
                    "pdfGroupIdentities": "|".join(sorted(groups_by_asset[asset_key])),
                    "status": "mapped_as_enrichment_not_inventory_authority",
                    "assetKey": asset_key,
                }
            )
        for url in sorted(OFFICIAL_WEB_ONLY_ACCESSORY_URLS):
            official = official_by_url.get(url)
            if official is None:
                raise SanyccesPoolError("reviewed official Pool accessory disappeared")
            official_crosswalk.append(
                {
                    "officialTitle": official["title"],
                    "officialUrl": official["url"],
                    "officialImageUrl": official["imageUrl"],
                    "pdfGroupIdentities": "",
                    "status": "official_web_only_not_in_attached_pdf_pool_inventory",
                    "assetKey": "",
                }
            )
        for kit_identity in sorted(KIT_RELATED_ASSETS):
            official_crosswalk.append(
                {
                    "officialTitle": POOL_TITLES[kit_identity],
                    "officialUrl": "",
                    "officialImageUrl": "",
                    "pdfGroupIdentities": kit_identity,
                    "status": "pdf_kit_without_standalone_official_product_page",
                    "assetKey": "",
                }
            )

        summary = {
            "pool": {
                "inventoryGroups": len(articles),
                "productArticles": sum(item["articleKind"] == "product_article" for item in articles),
                "componentRecords": sum(item["articleKind"] == "component_record" for item in articles),
                "standaloneSanyboxProducts": sum(
                    item["merchandisingDecision"]
                    == "standalone_sellable_sanybox_product_approved"
                    for item in articles
                ),
                "variableProductsSupported": sum(
                    item["productModelRecommendation"] == "variable_by_finish"
                    for item in articles
                ),
                "dedicatedOfficialWebpPrepared": sum(item["media"]["primary"] is not None for item in articles),
                "uniqueOfficialWebpAssets": len(official_media),
                "kitsWithoutDedicatedHero": sum(item["media"]["primary"] is None for item in articles),
                "exactPoolSkusPublished": sum(
                    row["publicationState"] == "export_publish"
                    for row in reference_audit
                    if row["sections"] == "pool"
                ),
                "exactPoolSkusMissing": sum(
                    row["publicationState"] == "absent_from_export"
                    for row in reference_audit
                    if row["sections"] == "pool"
                ),
                "contextOnlyReferences": len(pool_context_references),
                "totalObservedReferences": len(pool_candidates),
            },
            "pdfInventory": {
                "references": len(reference_audit),
                "groups": len(group_audit),
                "referenceStates": dict(sorted(Counter(item["publicationState"] for item in reference_audit).items())),
                "groupStates": dict(sorted(Counter(item["publicationState"] for item in group_audit).items())),
            },
            "publishedWebsite": {
                "publishedExportParents": len(published_crosswalk),
                "storeApiProducts": len(live_products),
                "directHttp200OutsideStoreApi": sum(
                    item["publicVerification"] == "direct_http_200" for item in published_crosswalk
                ),
                "scopeStates": dict(sorted(Counter(item["catalogScopeState"] for item in published_crosswalk).items())),
                "publishedCommercialSkuRows": len(published_tariff_audit),
                "publishedCommercialUniqueSkus": len(
                    {item["reference"] for item in published_tariff_audit}
                ),
                "publishedSimpleProducts": sum(
                    item["status"] == "publish"
                    and item["parentId"] in {"", "0"}
                    and item["productType"] == "simple"
                    for item in woo_rows
                ),
                "publishedVariations": sum(
                    item["status"] == "publish" and item["parentId"] not in {"", "0"}
                    for item in woo_rows
                ),
                "publishedParentsAllTariffCovered": sum(
                    item["tariffCoverageStatus"] == "all_sellable_skus_match_official_tariff"
                    for item in published_crosswalk
                ),
                "variableParentLocalSkuScaffolds": sum(
                    item["status"] == "publish"
                    and item["parentId"] in {"", "0"}
                    and item["productType"] == "variable"
                    and bool(item["sku"])
                    for item in woo_rows
                ),
            },
            "prices": {
                "officialTariffRows": len(tariff["records"]),
                "officialTariffUniqueReferences": len(tariff_by_reference),
                "officialTariffZeroPrices": sum(
                    record["pvpExVat"] == 0 for record in tariff["records"]
                ),
                "officialTariffInvalidEans": sum(
                    record["eanStatus"] == "invalid_requires_review"
                    for record in tariff["records"]
                ),
                "officialTariffExplicitTaxBasisSignals": tariff["explicitTaxBasisSignals"],
                "pdfInventoryTariffMatches": len(reference_audit),
                "poolTariffMatches": len(pool_price_audit),
                "storeProductsCompared": len(live_price_rows),
                "storeVariationsCompared": sum(len(item.get("variations", [])) for item in live_products),
                "storeExportExactMatches": sum(
                    item["auditStatus"] == "exact_live_export_match" for item in live_price_rows
                ),
                "publishedPdfReferencesWithOfficialTariff": len(price_audit),
                "publishedRegularExactTariffMatches": sum(
                    item["regularMatchesOfficialTariff"] for item in price_audit
                ),
                "regularGrossDividedBy1_21ExactToCent": sum(
                    item["derivedNetIsExactToCent"] for item in price_audit
                ),
                "confirmedTariffPriceErrors": sum(
                    item["priceErrorConfirmed"] for item in published_tariff_audit
                ),
                "publishedExactTariffSkuMatches": sum(
                    item["tariffComparisonStatus"] == "exact_official_tariff_match"
                    for item in published_tariff_audit
                ),
                "publishedCompositeTariffSkuMatches": sum(
                    item["tariffComparisonStatus"] == "official_tariff_composite_match"
                    for item in published_tariff_audit
                ),
                "publishedSkuMissingFromTariff": sum(
                    item["tariffComparisonStatus"] == "published_sku_missing_from_tariff"
                    for item in published_tariff_audit
                ),
                "publishedRegularPriceMissing": sum(
                    item["tariffComparisonStatus"] == "published_regular_price_missing"
                    for item in published_tariff_audit
                ),
                "officialTariffSkusWithoutExactPublishedSku": len(tariff_not_published_audit),
                "officialTariffSkusUsedAsCompositeComponents": sum(
                    item["publishedRepresentationStatus"] == "used_as_composite_component"
                    for item in tariff_not_published_audit
                ),
                "officialTariffSkusNotRepresented": sum(
                    item["publishedRepresentationStatus"]
                    == "not_represented_by_published_commercial_sku"
                    for item in tariff_not_published_audit
                ),
                "tariffPriceAuditStatus": "all_published_sellable_skus_reconciled_to_official_tariff",
                "tariffTaxBasisStatus": (
                    "no_explicit_tax_label_cross_validated_against_regular_gross_at_21_percent"
                    if not tariff["explicitTaxBasisSignals"]
                    else "explicit_tax_label_present_requires_text_review"
                ),
                "pdfPublishedDiscountDistribution": dict(
                    sorted(Counter(item["discountPercent"] for item in price_audit).items())
                ),
                "discountDistribution": dict(
                    sorted(Counter(item["discountPercent"] for item in published_tariff_audit).items())
                ),
                "discountPolicyKey": SANYCCES_DISCOUNT_POLICY_KEY,
                "discountPolicyBasis": "official_pvp_ex_vat",
                "discountPolicyMatches": sum(
                    item["discountPolicyStatus"] == "exact_policy_match"
                    for item in published_tariff_audit
                ),
                "discountPolicyMismatches": sum(
                    item["discountPolicyStatus"] != "exact_policy_match"
                    for item in published_tariff_audit
                ),
            },
            "officialPool": {
                "cards": len(official_listing),
                "mappedOfficialPages": len(OFFICIAL_ASSETS),
                "webOnlyAccessories": len(OFFICIAL_WEB_ONLY_ACCESSORY_URLS),
                "pdfKitsWithoutStandaloneOfficialPage": len(KIT_RELATED_ASSETS),
            },
        }

        _write_jsonl(run_directory / "pool-articles.jsonl", articles)
        _write_csv(run_directory / "pool-articles.csv", _article_csv_rows(articles))
        _write_json(run_directory / "pool-media-manifest.json", list(official_media.values()))
        _write_jsonl(run_directory / "catalog-reference-audit.jsonl", reference_audit)
        _write_csv(run_directory / "catalog-reference-audit.csv", reference_audit)
        _write_jsonl(run_directory / "catalog-group-audit.jsonl", group_audit)
        _write_csv(run_directory / "catalog-group-audit.csv", group_audit)
        _write_jsonl(run_directory / "published-product-crosswalk.jsonl", published_crosswalk)
        _write_csv(run_directory / "published-product-crosswalk.csv", published_crosswalk)
        _write_jsonl(run_directory / "price-audit.jsonl", price_audit)
        _write_csv(run_directory / "price-audit.csv", price_audit)
        _write_jsonl(run_directory / "published-tariff-audit.jsonl", published_tariff_audit)
        _write_csv(run_directory / "published-tariff-audit.csv", published_tariff_audit)
        _write_jsonl(run_directory / "tariff-not-published-audit.jsonl", tariff_not_published_audit)
        _write_csv(run_directory / "tariff-not-published-audit.csv", tariff_not_published_audit)
        _write_jsonl(run_directory / "pool-price-audit.jsonl", pool_price_audit)
        _write_csv(run_directory / "pool-price-audit.csv", pool_price_audit)
        _write_jsonl(run_directory / "live-export-price-audit.jsonl", live_price_rows)
        _write_csv(run_directory / "live-export-price-audit.csv", live_price_rows)
        _write_jsonl(run_directory / "official-pool-crosswalk.jsonl", official_crosswalk)
        _write_csv(run_directory / "official-pool-crosswalk.csv", official_crosswalk)
        _write_json(run_directory / "pdf-price-scan.json", price_scan)
        _write_json(
            run_directory / "official-tariff-summary.json",
            {
                "sourceSha256": tariff_sha256,
                "sheetName": tariff["sheetName"],
                "usedRange": tariff["usedRange"],
                "tariffKey": "PVPNA",
                "records": len(tariff["records"]),
                "uniqueReferences": len(tariff_by_reference),
                "zeroPrices": summary["prices"]["officialTariffZeroPrices"],
                "invalidEans": summary["prices"]["officialTariffInvalidEans"],
                "explicitTaxBasisSignals": tariff["explicitTaxBasisSignals"],
                "taxBasisStatus": summary["prices"]["tariffTaxBasisStatus"],
                "pdfInventoryMatches": summary["prices"]["pdfInventoryTariffMatches"],
                "poolMatches": summary["prices"]["poolTariffMatches"],
                "publishedExactRegularMatches": summary["prices"]["publishedRegularExactTariffMatches"],
                "publishedCommercialSkuRows": summary["publishedWebsite"]["publishedCommercialSkuRows"],
                "publishedExactTariffSkuMatches": summary["prices"]["publishedExactTariffSkuMatches"],
                "publishedCompositeTariffSkuMatches": summary["prices"]["publishedCompositeTariffSkuMatches"],
                "publishedSkuMissingFromTariff": summary["prices"]["publishedSkuMissingFromTariff"],
                "officialTariffSkusWithoutExactPublishedSku": summary["prices"][
                    "officialTariffSkusWithoutExactPublishedSku"
                ],
                "officialTariffSkusNotRepresented": summary["prices"][
                    "officialTariffSkusNotRepresented"
                ],
                "confirmedPriceErrors": summary["prices"]["confirmedTariffPriceErrors"],
                "discountPolicyKey": summary["prices"]["discountPolicyKey"],
                "discountPolicyMatches": summary["prices"]["discountPolicyMatches"],
                "discountPolicyMismatches": summary["prices"]["discountPolicyMismatches"],
            },
        )
        _write_json(run_directory / "summary.json", summary)

        report = f"""# Preparación Pool y auditoría Sanycces

## Resultado ejecutivo

- Se han preparado **{summary['pool']['inventoryGroups']}** registros Pool del PDF: **{summary['pool']['productArticles']}** artículos de producto y **{summary['pool']['componentRecords']}** Sanybox/componentes aprobados como productos independientes.
- Ninguna de las **{summary['pool']['exactPoolSkusMissing']} referencias de inventario Pool** está en la exportación actual; las otras {summary['pool']['contextOnlyReferences']} referencias observadas son menciones de compatibilidad y no productos. Las 52 referencias de inventario tienen PVP oficial, precio regular con IVA y precio rebajado derivados de la política aprobada.
- Se han generado **{summary['pool']['uniqueOfficialWebpAssets']} WebP oficiales** de 1000×1000 px, sin reescalar píxeles ni conservar metadatos. Cuatro kits conservan los componentes relacionados, pero necesitan una imagen principal específica.
- El inventario completo del PDF contiene **{summary['pdfInventory']['groups']} grupos** y **{summary['pdfInventory']['references']} referencias** auditables: {summary['pdfInventory']['groupStates'].get('fully_published', 0)} grupos publicados completos, {summary['pdfInventory']['groupStates'].get('partially_published', 0)} parciales y {summary['pdfInventory']['groupStates'].get('absent_from_export', 0)} ausentes.
- La web actual tiene **{summary['publishedWebsite']['publishedExportParents']} productos padre publicados**: {summary['publishedWebsite']['storeApiProducts']} aparecen en Store API y 4 mamparas adicionales se verificaron con HTTP 200. Sus **{summary['publishedWebsite']['publishedCommercialSkuRows']} SKU vendibles** son {summary['publishedWebsite']['publishedSimpleProducts']} productos simples y {summary['publishedWebsite']['publishedVariations']} variaciones. Los SKU de los padres variables son identificadores locales de agrupación y no se comparan como referencias comerciales.
- El PDF adjunto solo cubre grifería. Que un producto publicado no aparezca en ese PDF no es evidencia de que sobre, esté obsoleto o tenga una identidad errónea; para esa decisión hace falta el catálogo correspondiente.
- Los **{summary['prices']['storeProductsCompared']} productos del Store API** coinciden exactamente con la exportación en precio mínimo regular, precio rebajado, precio actual y pertenencia de sus **{summary['prices']['storeVariationsCompared']} variaciones**.

## Precios, IVA y descuentos

La tarifa oficial `PVP_NACIONAL_2026.xlsx` contiene **{summary['prices']['officialTariffRows']} referencias únicas** y cubre las **{summary['prices']['pdfInventoryTariffMatches']} referencias de inventario del PDF**, incluidas las **{summary['prices']['poolTariffMatches']} referencias Pool**. No hay duplicados y ninguna referencia Pool tiene PVP cero.

La política comercial `sanycces-pvp-tier-2026-v1` usa el PVP oficial sin IVA: 5 % por debajo de 25 €, 7,5 % desde 25 € hasta menos de 50 €, 10 % desde 50 € hasta menos de 100 €, 15 % desde 100 € hasta menos de 250 €, 17,5 % desde 250 € hasta menos de 500 € y 20 % desde 500 €. El precio regular se calcula primero con el 21 % de IVA y después se aplica el descuento, redondeando cada precio a dos decimales. La regla reproduce exactamente **{summary['prices']['discountPolicyMatches']} de {summary['publishedWebsite']['publishedCommercialSkuRows']}** precios rebajados publicados.

## Cruce completo de publicados frente a tarifa

- **{summary['prices']['publishedExactTariffSkuMatches']} SKU publicados** coinciden directamente con una referencia de tarifa.
- Otros **{summary['prices']['publishedCompositeTariffSkuMatches']} SKU publicados** son combinaciones internas de los dos productos Cardiff: referencia base más `SOLIDMEC` para mecanizado de grifería, `SOLIDTWMEC` para mecanizado de toallero o ambos. Las 21 combinaciones reproducen exactamente su precio regular.
- Los **{summary['publishedWebsite']['publishedCommercialSkuRows']} SKU vendibles** tienen precio regular justificable con la tarifa. Faltan **{summary['prices']['publishedSkuMissingFromTariff']}** identidades sin resolver y hay **{summary['prices']['confirmedTariffPriceErrors']}** diferencias de precio confirmadas.
- Hay **{summary['prices']['officialTariffSkusWithoutExactPublishedSku']} referencias de tarifa** sin un SKU publicado idéntico. Dos se usan como componentes de los Cardiff y **{summary['prices']['officialTariffSkusNotRepresented']}** no están representadas en la web. Esto es un inventario de oportunidad, no una lista automática de productos que deban publicarse: la tarifa también contiene accesorios, componentes, servicios y familias de catálogos todavía no aportados.

La hoja no incluye una etiqueta explícita sobre IVA. La base sin IVA queda, no obstante, contrastada por los **{summary['publishedWebsite']['publishedCommercialSkuRows']} SKU vendibles**: al aplicar el 21 % al PVP de tarifa o a la suma de componentes se reproduce exactamente el precio regular bruto de Woo. El descuento sigue siendo una capa comercial separada, pero ya se aplica determinísticamente a los candidatos Pool con trazabilidad a la política aprobada.

El PDF técnico sigue sin contener importes monetarios. Se mantiene como fuente de inventario y especificaciones; la tarifa se usa como fuente comercial de PVP.

## Reconciliación de Pool con la web oficial

- El filtro oficial muestra 26 fichas Pool.
- 22 fichas oficiales enriquecen 24 grupos del PDF: 18 fichas de producto cubren 20 grupos base y 4 fichas cubren los cuatro Sanybox, que se preparan como productos independientes.
- Cuatro accesorios aparecen en la web oficial pero no en el inventario Pool del PDF adjunto; se registran como `official_web_only_not_in_attached_pdf_pool_inventory` y no se añaden automáticamente.
- Cuatro kits existen en el PDF pero no tienen ficha oficial independiente; se preparan desde su composición documentada en el PDF y quedan pendientes de imagen principal.

## Decisión pendiente antes de publicar

1. Crear o aprobar una imagen principal específica para cada uno de los cuatro kits.
2. Clasificar por familia y catálogo las {summary['prices']['officialTariffSkusNotRepresented']} referencias de tarifa no representadas antes de decidir cuáles son productos vendibles, componentes o servicios y cuáles interesa preparar.
"""
        (run_directory / "report.md").write_text(report, encoding="utf-8")

        result = {
            "schema": POOL_PREPARATION_SCHEMA,
            "runtimeVersion": PIPELINE_VERSION,
            "runId": run_id,
            "valid": True,
            "summary": summary,
            "priceScan": price_scan,
            "tariff": {
                "sourceSha256": tariff_sha256,
                "tariffKey": "PVPNA",
                "records": len(tariff["records"]),
                "taxBasisStatus": summary["prices"]["tariffTaxBasisStatus"],
            },
            "authority": {
                "catalogInventorySource": "official_pdf",
                "officialPriceSource": "official_pvp_nacional_tariff",
                "officialWebsiteUse": "enrichment_only",
                "canPublish": False,
                "canCreateWooDraft": False,
                "outputMode": "local_review_only",
            },
            "outputs": {
                "poolArticles": "pool-articles.jsonl",
                "poolArticlesCsv": "pool-articles.csv",
                "groupAudit": "catalog-group-audit.csv",
                "referenceAudit": "catalog-reference-audit.csv",
                "publishedCrosswalk": "published-product-crosswalk.csv",
                "priceAudit": "price-audit.csv",
                "publishedTariffAudit": "published-tariff-audit.csv",
                "tariffNotPublishedAudit": "tariff-not-published-audit.csv",
                "poolPriceAudit": "pool-price-audit.csv",
                "liveExportPriceAudit": "live-export-price-audit.csv",
                "officialPoolCrosswalk": "official-pool-crosswalk.csv",
                "officialTariffSummary": "official-tariff-summary.json",
                "report": "report.md",
                "artifactManifest": "artifact-manifest.json",
            },
        }
        _write_json(run_directory / "preparation.json", result)

        sources = [
            {
                "kind": key,
                "path": workspace.relative_files[key],
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
            for key, path in sorted(workspace.files.items())
        ]
        sources.append({"kind": "sanycces_adapter", "sha256": adapter_sha256})
        manifest = _artifact_manifest(run_directory, sources)
        _write_json(run_directory / "artifact-manifest.json", manifest)
        return result
    except Exception:
        shutil.rmtree(run_directory, ignore_errors=True)
        raise
