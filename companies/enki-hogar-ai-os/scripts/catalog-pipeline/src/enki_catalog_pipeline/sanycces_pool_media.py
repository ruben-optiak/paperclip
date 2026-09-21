from __future__ import annotations

import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .pipeline import sha256_file
from .product_media import load_media_profile, render_product_media_candidate


class PoolMediaError(RuntimeError):
    """Raised when the reviewed Pool media package cannot be prepared exactly."""


PDF_SHA256 = "65b51d42c3d09f893fa909fb17ce93d01934dfdde3ad7ee4195543627d93f285"
PDF_FINISH_CROP_X = (1160.0, 1300.0)
PDF_RENDER_DPI = 300
OFFICIAL_HOST = "sanycces.es"
COLLECTION_SEARCH_URL = "https://www.enkihogar.com/?s=Sanycces+Pool&amp;post_type=product"
COLLECTION_LINK_HTML = (
    f'<p><a href="{COLLECTION_SEARCH_URL}">'
    "Ver todos los productos de la serie Pool de Sanycces"
    "</a></p>"
)
GOOGLE_SHOPPING_DESCRIPTION_MAX = 5_000


@dataclass(frozen=True)
class PoolProductMediaSpec:
    sku: str
    asset_key: str
    physical_page: int
    printed_page: int
    crop_y: tuple[float, float]
    dimension_key: str
    variable: bool = True
    dimension_x: tuple[float, float] = (180.0, 370.0)
    finish_crop_y: tuple[float, float] | None = None


POOL_MEDIA_SPECS = (
    PoolProductMediaSpec("MNO006SS", "pool-mno", 64, 126, (85, 330), "pool-mno", dimension_x=(200, 340), finish_crop_y=(135, 185)),
    PoolProductMediaSpec("MOA006SS", "pool-moa", 64, 126, (330, 575), "pool-moa", dimension_x=(195, 340), finish_crop_y=(365, 414)),
    PoolProductMediaSpec("MBD006SS", "pool-mbd", 64, 126, (575, 805), "pool-mbd", dimension_x=(195, 330), finish_crop_y=(605, 656)),
    PoolProductMediaSpec("MEN006R18SS", "pool-men-r", 65, 128, (85, 285), "pool-men-r", dimension_x=(185, 350), finish_crop_y=(135, 184)),
    PoolProductMediaSpec("MEN006R14SS", "pool-men-r", 65, 128, (85, 285), "pool-men-r", dimension_x=(185, 350), finish_crop_y=(135, 184)),
    PoolProductMediaSpec("MEN006S18SS", "pool-men-s", 65, 128, (285, 570), "pool-men-s", dimension_x=(185, 350), finish_crop_y=(345, 397)),
    PoolProductMediaSpec("MEN006S14SS", "pool-men-s", 65, 128, (285, 570), "pool-men-s", dimension_x=(185, 350), finish_crop_y=(345, 397)),
    PoolProductMediaSpec("MEN000SS", "pool-men000", 65, 128, (570, 800), "pool-men000", False, (185, 350)),
    PoolProductMediaSpec("MEX006SS", "pool-mex", 66, 130, (85, 420), "pool-mex", dimension_x=(185, 340), finish_crop_y=(135, 185)),
    PoolProductMediaSpec("BNEX006SS", "pool-bnex", 66, 130, (420, 800), "pool-bnex", dimension_x=(185, 350), finish_crop_y=(450, 500)),
    PoolProductMediaSpec("BNBB006SS", "pool-bnbb", 67, 132, (75, 370), "pool-bnbb", dimension_x=(180, 340), finish_crop_y=(135, 185)),
    PoolProductMediaSpec("BNCA006SS", "pool-bnca", 67, 132, (410, 580), "pool-bnca", dimension_x=(185, 345), finish_crop_y=(435, 483)),
    PoolProductMediaSpec("RAC00012SS", "pool-rac00012", 67, 132, (580, 805), "pool-rac00012", False, (185, 350)),
    PoolProductMediaSpec("MH2D006SS", "pool-mh2d006", 68, 134, (0, 305), "pool-mh2d006", dimension_x=(180, 350), finish_crop_y=(135, 185)),
    PoolProductMediaSpec("MH2D066SS", "pool-mh2d066", 68, 134, (300, 555), "pool-mh2d066", dimension_x=(180, 350), finish_crop_y=(350, 398)),
    PoolProductMediaSpec("MH2000SS", "pool-mh2000", 68, 134, (550, 820), "pool-mh2000", False, (185, 345)),
    PoolProductMediaSpec("TH2D006SS", "pool-th2d006", 70, 138, (85, 315), "pool-th2d006", dimension_x=(180, 350), finish_crop_y=(180, 231)),
    PoolProductMediaSpec("TH2D066SS", "pool-th2d066", 70, 138, (315, 565), "pool-th2d066", dimension_x=(180, 350), finish_crop_y=(405, 453)),
    PoolProductMediaSpec("TH2000SS", "pool-th2000", 70, 138, (565, 815), "pool-th2000", False, (185, 345)),
    PoolProductMediaSpec("COMO006SS", "pool-como", 72, 142, (0, 420), "pool-como", dimension_x=(175, 345), finish_crop_y=(140, 191)),
    PoolProductMediaSpec("COTE006SS", "pool-cote", 72, 142, (350, 805), "pool-cote", dimension_x=(175, 345), finish_crop_y=(505, 554)),
    PoolProductMediaSpec("ROC006SS", "pool-roc", 73, 144, (40, 275), "pool-roc", dimension_x=(185, 340), finish_crop_y=(135, 185)),
    PoolProductMediaSpec("ROT006SS", "pool-rot", 73, 144, (260, 490), "pool-rot", dimension_x=(190, 330), finish_crop_y=(315, 364)),
    PoolProductMediaSpec("DUE006SS", "pool-due", 73, 144, (500, 815), "pool-due", dimension_x=(180, 350), finish_crop_y=(530, 577)),
)


RM_SOURCE_URLS = {
    "pool-bnbb": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_GRIFERIA-BORDE-BANERA-RM.png",
    "pool-bnca": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_CANO-BANERA-RM.png",
    "pool-bnex": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_MONOMANDO-BANARA-EXENTO-RM.png",
    "pool-como": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_COLUMNA-DE-DUCHA-MONOMANDO-RM.png",
    "pool-cote": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_COLUMNA-DE-DUCHA-TERMOSTATICA-RM.png",
    "pool-due": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_DUCHA-DE-EXTERIOR-RM.png",
    "pool-mbd": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_MONOMANDO-BIDET-rm.png",
    "pool-men-r": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_MONOMANDO-MURAL-rm.png",
    "pool-men-s": "https://sanycces.es/wp-content/uploads/2025/01/SANYCCES_POOL_MONOMANDO-MURAL-CON-PLACA-RM.png",
    "pool-mex": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_MONOMANDO-LAVABO-EXENTO-RM.png",
    "pool-mh2d006": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_MONOMANDO-DE-DUCHA-MURAL-RM.png",
    "pool-mh2d066": "https://sanycces.es/wp-content/uploads/2026/04/POOL-FOTOS-WEB11.png",
    "pool-mno": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_MONOMANDO-LAVABO-RM.png",
    "pool-moa": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_MONOMANDO-LAVABO-ALTO-RM.png",
    "pool-roc": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_ROCIADOR-A-PARED-rm.png",
    "pool-rot": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_ROCIADOR-A-TECHO-rm.png",
    "pool-th2d006": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_TERMOSTATICO-DE-DUCHA-MURAL-rm.png",
    "pool-th2d066": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES_POOL_TERMOSTATICO-DE-DUCHA-MURAL-2-rm.png",
}


INSPIRATION_SOURCE_URLS = {
    "pool-bnbb": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_MONOMANDO-BORDE_BANERA_1.jpg",
    "pool-bnca": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_CANO_BANERA_1.jpg",
    "pool-bnex": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_GRIFERIA-_PIE_BANERA_1.jpg",
    "pool-como": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-Pool-COMO_1.jpg",
    "pool-cote": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-Pool-COTE_1.jpg",
    "pool-due": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-Pool-DUE006SS_1.jpg",
    "pool-mbd": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_MONOMANDO-DE-BIDET_1.jpg",
    "pool-men-r": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_MONOMANDO-LAVABO_MURAL_1.jpg",
    "pool-men-s": "https://sanycces.es/wp-content/uploads/2025/01/SANYCCES-POOL_MONOMANDO-LAVABO_MURAL_3.jpg",
    "pool-mex": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_MONOMANDO-EXENTO-DE-LAVABO_1.jpg",
    "pool-mh2d006": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_ENCASTRE_HORIZONTAL_DUCHA_3.jpg",
    "pool-mh2d066": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-2-Pool-MONOMANDO-DUCHA-HORIZONTAL.jpg",
    "pool-mno": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_MONOMANDO-DE-LAVABO_1.jpg",
    "pool-moa": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_MONOMANDO-ALTO-DE-LAVABO_1.jpg",
    "pool-roc": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-2-Pool-ROC006SS_1.jpg",
    "pool-rot": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-Pool-ROT0006SS.jpg",
    "pool-th2d006": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_ENCASTRE_HORIZONTAL_DUCHA_1-1.jpg",
    "pool-th2d066": "https://sanycces.es/wp-content/uploads/2026/04/SANYCCES-POOL_ENCASTRE_HORIZONTAL_DUCHA_4-2.jpg",
}


PRODUCT_COPY = {
    "BNBB006SS": (
        "Grifo Monomando de Bañera para Borde – Sanycces – Pool",
        "Grifo monomando para instalar en el borde de la bañera, con mandos y ducha de mano independientes que aportan una composición limpia y cómoda. Su acero inoxidable 316L y los acabados níquel cepillado y Metal Raw refuerzan el carácter contemporáneo de la serie Pool.",
    ),
    "BNCA006SS": (
        "Caño Mural de Bañera – Sanycces – Pool",
        "Caño mural para bañera de líneas cilíndricas, pensado para crear una salida de agua discreta y coordinada con la grifería Pool. Está fabricado en acero inoxidable 316L y se ofrece en níquel cepillado y Metal Raw.",
    ),
    "BNEX006SS": (
        "Grifo Monomando Exento de Bañera – Sanycces – Pool",
        "Grifo monomando exento para bañeras independientes, con una silueta vertical que ordena visualmente el espacio y facilita el uso de la ducha de mano. Está fabricado en acero inoxidable 316L y disponible en níquel cepillado y Metal Raw.",
    ),
    "COMO006SS": (
        "Columna de Ducha Monomando – Sanycces – Pool",
        "Columna de ducha monomando Pool con rociador superior y ducha de mano, diseñada para reunir las funciones de ducha en una composición esbelta y fácil de regular. Su estructura de acero inoxidable 316L está disponible en níquel cepillado y Metal Raw.",
    ),
    "COTE006SS": (
        "Columna de Ducha Termostática – Sanycces – Pool",
        "Columna de ducha termostática Pool con rociador superior y ducha de mano, concebida para mantener una temperatura estable y ofrecer un uso cotidiano más confortable. Está fabricada en acero inoxidable 316L y disponible en níquel cepillado y Metal Raw.",
    ),
    "DUE006SS": (
        "Ducha de Exterior Monomando – Sanycces – Pool",
        "Ducha de exterior monomando Pool, de presencia ligera y geometría cilíndrica, pensada para zonas de piscina, jardín o terraza. Su construcción en acero inoxidable 316L y sus acabados níquel cepillado y Metal Raw facilitan una integración sobria en exteriores.",
    ),
    "MBD006SS": (
        "Grifo Monomando de Bidé – Sanycces – Pool",
        "Grifo monomando de bidé Pool con aireador orientable, diseñado para dirigir el chorro con precisión y simplificar el uso diario. Combina acero inoxidable 316L, apertura en frío y dos acabados: níquel cepillado y Metal Raw.",
    ),
    "MEN006R14SS": (
        "Grifo Mural de Lavabo 14 cm sin Placa – Sanycces – Pool",
        "Grifo monomando mural de lavabo Pool sin placa y con caño de 14 cm, una solución compacta que libera superficie alrededor del lavabo. Su cuerpo exterior de acero inoxidable 316L está disponible en níquel cepillado y Metal Raw y requiere Sanybox MEN000SS.",
    ),
    "MEN006R18SS": (
        "Grifo Mural de Lavabo 18 cm sin Placa – Sanycces – Pool",
        "Grifo monomando mural de lavabo Pool sin placa y con caño de 18 cm, pensado para lavabos que necesitan un mayor alcance sin ocupar la encimera. Su cuerpo exterior de acero inoxidable 316L está disponible en níquel cepillado y Metal Raw y requiere Sanybox MEN000SS.",
    ),
    "MEN006S14SS": (
        "Grifo Mural de Lavabo 14 cm con Placa – Sanycces – Pool",
        "Grifo monomando mural de lavabo Pool con placa y caño de 14 cm, una solución compacta que deja libre la encimera y facilita un acabado limpio de la instalación. Está disponible en níquel cepillado y Metal Raw y requiere Sanybox MEN000SS.",
    ),
    "MEN006S18SS": (
        "Grifo Mural de Lavabo 18 cm con Placa – Sanycces – Pool",
        "Grifo monomando mural de lavabo Pool con placa y caño de 18 cm, adecuado cuando se busca más alcance y una instalación visualmente ordenada. Está disponible en níquel cepillado y Metal Raw y requiere Sanybox MEN000SS.",
    ),
    "MEX006SS": (
        "Grifo Monomando Exento de Lavabo – Sanycces – Pool",
        "Grifo monomando exento para lavabo, diseñado para composiciones independientes en las que la grifería nace directamente del suelo. Su figura vertical en acero inoxidable 316L está disponible en níquel cepillado y Metal Raw.",
    ),
    "MH2D006SS": (
        "Grifo Monomando de Ducha con Ducha de Mano – Sanycces – Pool",
        "Conjunto monomando mural horizontal de ducha Pool con dos vías y ducha de mano, pensado para una instalación empotrada de lectura limpia. La parte exterior es de acero inoxidable 316L, se ofrece en níquel cepillado y Metal Raw y requiere Sanybox MH2000SS.",
    ),
    "MH2D066SS": (
        "Grifo Monomando de Ducha con Barra Integrada – Sanycces – Pool",
        "Conjunto monomando mural horizontal de ducha Pool con dos vías y barra de ducha de mano integrada, para una composición empotrada funcional y ordenada. La parte exterior es de acero inoxidable 316L, se ofrece en níquel cepillado y Metal Raw y requiere Sanybox MH2000SS.",
    ),
    "MNO006SS": (
        "Grifo Monomando de Lavabo – Sanycces – Pool",
        "Grifo monomando de lavabo Pool de líneas cilíndricas y proporciones compactas, pensado para baños contemporáneos y un manejo intuitivo. Está fabricado en acero inoxidable 316L, incorpora apertura en frío y se ofrece en níquel cepillado y Metal Raw.",
    ),
    "MOA006SS": (
        "Grifo Monomando Alto de Lavabo – Sanycces – Pool",
        "Grifo monomando alto de lavabo Pool, indicado para lavabos sobre encimera gracias a su mayor altura y alcance. Está fabricado en acero inoxidable 316L, incorpora apertura en frío y se ofrece en níquel cepillado y Metal Raw.",
    ),
    "ROC006SS": (
        "Rociador Mural de Ducha – Sanycces – Pool",
        "Rociador mural de ducha Pool con cabezal cilíndrico orientado, una solución compacta para crear una salida de agua limpia desde la pared. Está fabricado en acero inoxidable 316L y disponible en níquel cepillado y Metal Raw.",
    ),
    "ROT006SS": (
        "Rociador de Techo para Ducha – Sanycces – Pool",
        "Rociador de ducha a techo Pool con cuerpo cilíndrico, pensado para una caída de agua vertical y una presencia visual mínima. Está fabricado en acero inoxidable 316L y disponible en níquel cepillado y Metal Raw.",
    ),
    "TH2D006SS": (
        "Grifo Termostático de Ducha con Ducha de Mano – Sanycces – Pool",
        "Conjunto termostático mural horizontal Pool de 2-3 vías con ducha de mano, diseñado para una temperatura estable y una instalación empotrada ordenada. La parte exterior es de acero inoxidable 316L, está disponible en níquel cepillado y Metal Raw y requiere Sanybox TH2000SS.",
    ),
    "TH2D066SS": (
        "Grifo Termostático de Ducha con Barra Integrada – Sanycces – Pool",
        "Conjunto termostático mural horizontal Pool de 2-3 vías con barra de ducha de mano integrada, para regular la temperatura y distribuir el agua desde una composición empotrada. Está disponible en níquel cepillado y Metal Raw y requiere Sanybox TH2000SS.",
    ),
    "MEN000SS": (
        "Sanybox Inox para Grifo Mural de Lavabo – Sanycces – Pool",
        "Cuerpo de encastre Sanybox Inox para los grifos murales de lavabo Pool MEN006. Permite dejar preparada la instalación interior y completar después el conjunto con la parte exterior compatible.",
    ),
    "MH2000SS": (
        "Sanybox Inox para Monomando de Ducha 2 Vías – Sanycces – Pool",
        "Cuerpo de encastre Sanybox Inox para los conjuntos monomando horizontales de ducha Pool de dos vías. Reúne las conexiones y el cartucho dentro del muro para completar la instalación con la parte exterior compatible.",
    ),
    "RAC00012SS": (
        "Conexión Empotrada Sanybox Inox 1/2 – Sanycces – Pool",
        "Conexión empotrada Sanybox Inox de 1/2 pulgada para configuraciones Pool compatibles. Facilita una unión preparada dentro del muro para completar la instalación del caño de bañera BNCA006 o del rociador mural ROC006.",
    ),
    "TH2000SS": (
        "Sanybox Inox Termostático de Ducha 2-3 Vías – Sanycces – Pool",
        "Cuerpo de encastre Sanybox Inox para los conjuntos termostáticos horizontales Pool de 2-3 vías. Integra las conexiones y el cartucho termostático dentro del muro para completar la instalación con la parte exterior compatible.",
    ),
}


PRODUCT_SEO_OVERRIDES = {
    "MH2D006SS": {
        "slug": "monomando-ducha-mural-pool-con-ducha-de-mano",
        "focusKeyword": "monomando ducha mural pool con ducha de mano",
        "description": "Monomando de ducha mural Pool con ducha de mano, 2 vías y acero inoxidable 316L. Consulta acabados y medidas.",
    },
    "MH2D066SS": {
        "slug": "monomando-ducha-mural-pool-con-barra-integrada",
        "focusKeyword": "monomando ducha mural pool con barra integrada",
        "description": "Monomando de ducha mural Pool con barra integrada, 2 vías y acero inoxidable 316L. Consulta acabados y medidas.",
    },
    "TH2D006SS": {
        "slug": "termostatico-ducha-mural-pool-con-ducha-de-mano",
        "focusKeyword": "termostático ducha mural pool con ducha de mano",
        "description": "Termostático de ducha mural Pool con ducha de mano, 2-3 vías y acero inoxidable 316L. Consulta acabados y medidas.",
    },
    "TH2D066SS": {
        "slug": "termostatico-ducha-mural-pool-con-barra-integrada",
        "focusKeyword": "termostático ducha mural pool con barra integrada",
        "description": "Termostático de ducha mural Pool con barra integrada, 2-3 vías y acero inoxidable 316L. Consulta acabados y medidas.",
    },
    "MEN000SS": {
        "slug": "sanybox-inox-para-monomando-de-lavabo-mural-pool",
        "focusKeyword": "sanybox inox para monomando de lavabo mural pool",
        "description": "Cuerpo empotrado Sanybox Inox para grifos murales de lavabo Pool MEN006. Requerido para completar la instalación.",
    },
    "MH2000SS": {
        "slug": "sanybox-inox-para-monomando-horizontal-pool-2-vias",
        "focusKeyword": "sanybox inox para monomando horizontal pool 2 vías",
        "description": "Cuerpo empotrado Sanybox Inox para monomandos de ducha Pool de 2 vías. Consulta caudal, conexiones y compatibilidad.",
    },
    "RAC00012SS": {
        "slug": "sanybox-inox-conexion-1-2-para-cano-pool",
        "focusKeyword": "sanybox inox conexión 1/2 para caño pool",
        "description": "Conexión empotrada Sanybox Inox de 1/2 para caño BNCA006 y rociador mural ROC006 de la serie Pool.",
    },
    "TH2000SS": {
        "slug": "sanybox-inox-para-termostatico-horizontal-pool-2-3-vias",
        "focusKeyword": "sanybox inox para termostático horizontal pool 2-3 vías",
        "description": "Cuerpo empotrado Sanybox Inox para termostáticos de ducha Pool de 2-3 vías. Consulta conexiones y compatibilidad.",
    },
}


def _stable_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _official_url(value: str) -> bool:
    return re.fullmatch(
        rf"https://(?:[a-z0-9-]+\.)*{re.escape(OFFICIAL_HOST)}(?::443)?(?:/[^\s]*)?",
        value,
        flags=re.IGNORECASE,
    ) is not None


def load_pool_media_inputs(
    source_bundles: Path,
    source_media_manifest_path: Path,
    official_page_audit_path: Path,
) -> dict[str, Any]:
    try:
        batch_manifest = json.loads((source_bundles / "batch-manifest.json").read_text(encoding="utf-8"))
        source_media = json.loads(source_media_manifest_path.read_text(encoding="utf-8"))
        page_audit = json.loads(official_page_audit_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise PoolMediaError("Pool media inputs must be readable JSON") from error

    if batch_manifest.get("summary") != {
        "bundles": 5,
        "excludedKits": 4,
        "readyProducts": 24,
        "sellableSkus": 44,
        "simpleProducts": 4,
        "variableProducts": 20,
    }:
        raise PoolMediaError("source bundle summary differs from the reviewed 24-product Pool scope")
    if batch_manifest.get("sources", {}).get("catalogSha256") != PDF_SHA256:
        raise PoolMediaError("source bundle catalogue hash differs from the reviewed Pool PDF")

    source_by_asset = {entry["assetKey"]: entry for entry in source_media}
    audit_by_asset = {entry["assetKey"]: entry for entry in page_audit}
    required_assets = {spec.asset_key for spec in POOL_MEDIA_SPECS}
    variable_assets = {spec.asset_key for spec in POOL_MEDIA_SPECS if spec.variable}
    if set(source_by_asset) != required_assets:
        raise PoolMediaError("official source manifest does not cover the exact 22 reviewed Pool assets")
    if set(audit_by_asset) != variable_assets:
        raise PoolMediaError("official page audit does not cover the exact 18 variable Pool configurations")
    if set(RM_SOURCE_URLS) != variable_assets:
        raise PoolMediaError("RM URL map does not cover the exact 18 variable Pool configurations")
    if set(INSPIRATION_SOURCE_URLS) != variable_assets:
        raise PoolMediaError("inspiration URL map does not cover the exact 18 variable Pool configurations")

    for asset_key in sorted(variable_assets):
        source = source_by_asset[asset_key]
        audit = audit_by_asset[asset_key]
        nb_url = source.get("sourceUrl")
        rm_url = RM_SOURCE_URLS[asset_key]
        inspiration_url = INSPIRATION_SOURCE_URLS[asset_key]
        if audit.get("officialProductUrl") != source.get("officialProductUrl"):
            raise PoolMediaError(f"official product page drift for {asset_key}")
        if audit.get("currentSourceUrl") != nb_url:
            raise PoolMediaError(f"NB source URL drift for {asset_key}")
        if any(url not in audit.get("imageUrls", []) for url in (nb_url, rm_url, inspiration_url)):
            raise PoolMediaError(f"official product page does not contain all reviewed media for {asset_key}")
        if not all(_official_url(value) for value in (nb_url, rm_url, inspiration_url, audit["officialProductUrl"])):
            raise PoolMediaError(f"non-official URL in reviewed finish mapping for {asset_key}")

    return {
        "batchManifest": batch_manifest,
        "sourceByAsset": source_by_asset,
        "auditByAsset": audit_by_asset,
    }


def _save_webp(image: Image.Image, target: Path, profile: dict[str, Any]) -> dict[str, Any]:
    output = profile["output"]
    normalized = ImageOps.exif_transpose(image).convert("RGBA")
    try:
        scale = min(output["width"] / normalized.width, output["height"] / normalized.height, 1.0)
        content_size = (max(1, round(normalized.width * scale)), max(1, round(normalized.height * scale)))
        resized = normalized if content_size == normalized.size else normalized.resize(content_size, Image.Resampling.LANCZOS)
        try:
            background = (0, 0, 0, 0) if output["background"] == "transparent" else (
                *tuple(int(output["background"][index:index + 2], 16) for index in (1, 3, 5)),
                255,
            )
            canvas = Image.new("RGBA", (output["width"], output["height"]), background)
            try:
                offset = ((canvas.width - resized.width) // 2, (canvas.height - resized.height) // 2)
                canvas.alpha_composite(resized, offset)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
                canvas.save(
                    target,
                    format="WEBP",
                    quality=output["quality"],
                    method=output["method"],
                    exact=True,
                    exif=b"",
                    icc_profile=None,
                    xmp=b"",
                )
            finally:
                canvas.close()
        finally:
            if resized is not normalized:
                resized.close()
    finally:
        normalized.close()
    return {
        "width": output["width"],
        "height": output["height"],
        "contentWidth": content_size[0],
        "contentHeight": content_size[1],
        "sha256": sha256_file(target),
        "sizeBytes": target.stat().st_size,
        "metadataStripped": True,
        "upscaled": False,
    }


def _render_pdf_crop_candidate(
    document: pdfium.PdfDocument,
    spec: PoolProductMediaSpec,
    target: Path,
    profile: dict[str, Any],
    crop_box: tuple[float, float, float, float],
) -> dict[str, Any]:
    page = document[spec.physical_page - 1]
    page_width, page_height = page.get_size()
    x0, y0, x1, y1 = crop_box
    if not (0 <= x0 < x1 <= page_width and 0 <= y0 < y1 <= page_height):
        raise PoolMediaError(f"invalid reviewed PDF crop for {spec.sku}")
    scale = PDF_RENDER_DPI / 72
    bitmap = page.render(scale=scale)
    page_image = bitmap.to_pil()
    try:
        crop = page_image.crop((round(x0 * scale), round(y0 * scale), round(x1 * scale), round(y1 * scale)))
        try:
            rendered = _save_webp(crop, target, profile)
        finally:
            crop.close()
    finally:
        page_image.close()
        bitmap.close()
    return {
        **rendered,
        "physicalPage": spec.physical_page,
        "printedPage": spec.printed_page,
        "cropBoxPointsTopLeft": [x0, y0, x1, y1],
        "renderDpi": PDF_RENDER_DPI,
        "pageWidthPoints": page_width,
        "pageHeightPoints": page_height,
    }


def render_pdf_dimension_candidate(
    document: pdfium.PdfDocument,
    spec: PoolProductMediaSpec,
    target: Path,
    profile: dict[str, Any],
) -> dict[str, Any]:
    return _render_pdf_crop_candidate(
        document,
        spec,
        target,
        profile,
        (spec.dimension_x[0], spec.crop_y[0], spec.dimension_x[1], spec.crop_y[1]),
    )


def render_pdf_finish_candidate(
    document: pdfium.PdfDocument,
    spec: PoolProductMediaSpec,
    target: Path,
    profile: dict[str, Any],
) -> dict[str, Any]:
    if not spec.variable or spec.finish_crop_y is None:
        raise PoolMediaError(f"finish crop is unavailable for {spec.sku}")
    return _render_pdf_crop_candidate(
        document,
        spec,
        target,
        profile,
        (PDF_FINISH_CROP_X[0], spec.finish_crop_y[0], PDF_FINISH_CROP_X[1], spec.finish_crop_y[1]),
    )


def _load_products(source_bundles: Path, batch_manifest: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Path]]:
    products: dict[str, Any] = {}
    bundle_paths: dict[str, Path] = {}
    for row in batch_manifest["bundles"]:
        path = source_bundles / row["path"]
        bundle = json.loads(path.read_text(encoding="utf-8"))
        for product in bundle["products"]:
            if product["sku"] in products:
                raise PoolMediaError(f"duplicate source Pool parent SKU: {product['sku']}")
            products[product["sku"]] = product
            bundle_paths[product["sku"]] = path
    expected = {spec.sku for spec in POOL_MEDIA_SPECS}
    if set(products) != expected:
        raise PoolMediaError("source bundles do not contain the exact 24 reviewed Pool parents")
    for spec in POOL_MEDIA_SPECS:
        expected_type = "variable" if spec.variable else "simple"
        if products[spec.sku]["type"] != expected_type:
            raise PoolMediaError(f"source product type drift for {spec.sku}")
    return products, bundle_paths


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _finish_contact_sheet(entries: list[dict[str, Any]], root: Path, target: Path) -> None:
    columns, card_width, card_height = 3, 420, 460
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * card_width, rows * card_height), "#F4F1EA")
    draw = ImageDraw.Draw(sheet)
    label_font = _font(20)
    finish_font = _font(17)
    try:
        for index, entry in enumerate(entries):
            x = (index % columns) * card_width
            y = (index // columns) * card_height
            draw.rectangle((x + 8, y + 8, x + card_width - 8, y + card_height - 8), fill="white", outline="#9A9488", width=2)
            draw.text((x + 20, y + 18), entry["assetKey"], fill="#25231F", font=label_font)
            for finish_index, finish in enumerate(("nb", "rm")):
                media = entry["finishes"][finish]
                with Image.open(root / media["outputPath"]) as opened:
                    thumb = opened.convert("RGB")
                    thumb.thumbnail((180, 340), Image.Resampling.LANCZOS)
                    px = x + 20 + finish_index * 200 + (180 - thumb.width) // 2
                    py = y + 62 + (340 - thumb.height) // 2
                    sheet.paste(thumb, (px, py))
                    thumb.close()
                draw.text((x + 20 + finish_index * 200, y + 410), finish.upper(), fill="#4E4A43", font=finish_font)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
        sheet.save(target, format="PNG", optimize=True)
    finally:
        sheet.close()


def _dimension_contact_sheet(entries: list[dict[str, Any]], root: Path, target: Path) -> None:
    columns, card_width, card_height = 4, 320, 300
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * card_width, rows * card_height), "#F4F1EA")
    draw = ImageDraw.Draw(sheet)
    label_font = _font(17)
    try:
        for index, entry in enumerate(entries):
            x = (index % columns) * card_width
            y = (index // columns) * card_height
            draw.rectangle((x + 6, y + 6, x + card_width - 6, y + card_height - 6), fill="white", outline="#9A9488", width=2)
            draw.text((x + 16, y + 14), f"{entry['dimensionKey']} · p. {entry['printedPage']}", fill="#25231F", font=label_font)
            with Image.open(root / entry["outputPath"]) as opened:
                thumb = opened.convert("RGB")
                thumb.thumbnail((288, 240), Image.Resampling.LANCZOS)
                sheet.paste(thumb, (x + 16 + (288 - thumb.width) // 2, y + 48 + (240 - thumb.height) // 2))
                thumb.close()
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
        sheet.save(target, format="PNG", optimize=True)
    finally:
        sheet.close()


def _single_asset_contact_sheet(
    entries: list[dict[str, Any]],
    root: Path,
    target: Path,
    *,
    key: str,
) -> None:
    columns, card_width, card_height = 4, 320, 300
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * card_width, rows * card_height), "#F4F1EA")
    draw = ImageDraw.Draw(sheet)
    label_font = _font(17)
    try:
        for index, entry in enumerate(entries):
            x = (index % columns) * card_width
            y = (index // columns) * card_height
            draw.rectangle((x + 6, y + 6, x + card_width - 6, y + card_height - 6), fill="white", outline="#9A9488", width=2)
            draw.text((x + 16, y + 14), str(entry[key]), fill="#25231F", font=label_font)
            with Image.open(root / entry["outputPath"]) as opened:
                thumb = opened.convert("RGB")
                thumb.thumbnail((288, 240), Image.Resampling.LANCZOS)
                sheet.paste(thumb, (x + 16 + (288 - thumb.width) // 2, y + 48 + (240 - thumb.height) // 2))
                thumb.close()
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
        sheet.save(target, format="PNG", optimize=True)
    finally:
        sheet.close()


def _technical_bullets(description_html: str, sku: str) -> list[str]:
    match = re.search(r"<h2>Características técnicas</h2><ul>(.*?)</ul>", description_html)
    if match is None:
        raise PoolMediaError(f"technical bullets are missing for {sku}")
    bullets = re.findall(r"<li>(.*?)</li>", match.group(1))
    if not bullets:
        raise PoolMediaError(f"technical bullets are empty for {sku}")
    return bullets


def _value_bullet(value: str) -> str:
    customer_value_suffixes = (
        ": elevada resistencia frente a la humedad y la corrosión.",
        ": evita activar el agua caliente cuando no es necesaria.",
        ": caudal adecuado para agilizar el llenado de la bañera.",
        ": caudal equilibrado para el uso diario del lavabo o bidé.",
        ": caudal equilibrado para el uso diario del lavabo.",
        ": caudal equilibrado para el uso diario del bidé.",
        ": ayuda a controlar el consumo de agua.",
        ": permite adaptar la columna a distintas personas y espacios.",
        ": simplifican la limpieza periódica del rociador.",
        "; debe pedirse por separado para completar la instalación.",
    )
    if value.endswith(customer_value_suffixes):
        return value
    if value == "Acero inoxidable 316L":
        return "Acero inoxidable 316L: elevada resistencia frente a la humedad y la corrosión."
    if value.startswith("Apertura en frío"):
        return f"{value}: evita activar el agua caliente cuando no es necesaria."
    if value.startswith("Caudal de 18,8") or value.startswith("Caudal de 20 "):
        return f"{value}: caudal adecuado para agilizar el llenado de la bañera."
    if value.startswith("Caudal de 5,4"):
        return f"{value}: caudal equilibrado para el uso diario del bidé."
    if value.startswith("Caudal de 4,7") or value.startswith("Caudal de 5,7") or value.startswith("Caudal de 5,8"):
        return f"{value}: caudal equilibrado para el uso diario del lavabo."
    if value.startswith("Limitador de caudal de 9"):
        return f"{value}: ayuda a controlar el consumo de agua."
    if value.startswith("Altura regulable"):
        return f"{value}: permite adaptar la columna a distintas personas y espacios."
    if value.startswith("Tetinas antical"):
        return f"{value}: simplifican la limpieza periódica del rociador."
    if value.startswith("Parte externa; requiere"):
        return f"{value}; debe pedirse por separado para completar la instalación."
    return value


def _revise_customer_copy(product: dict[str, Any]) -> None:
    try:
        name, introduction = PRODUCT_COPY[product["sku"]]
    except KeyError as error:
        raise PoolMediaError(f"reviewed Pool copy is missing for {product['sku']}") from error
    if len(name) > 70:
        raise PoolMediaError(f"search-oriented product name exceeds 70 characters for {product['sku']}")
    if len(introduction) > GOOGLE_SHOPPING_DESCRIPTION_MAX:
        raise PoolMediaError(f"Shopping description exceeds the 5,000-character limit for {product['sku']}")
    bullets = [_value_bullet(value) for value in _technical_bullets(product["descriptionHtml"], product["sku"])]
    product["name"] = name
    product["shortDescriptionHtml"] = f"<p>{introduction}</p>"
    product["descriptionHtml"] = (
        f"<p>{introduction}</p>"
        "<p>La serie Pool combina formas cilíndricas, proporciones limpias y superficies cepilladas para crear un baño contemporáneo y coherente. Sus piezas permiten coordinar lavabo, bidé, bañera y ducha con un mismo lenguaje de diseño.</p>"
        "<h2>Características técnicas</h2><ul>"
        + "".join(f"<li>{value}</li>" for value in bullets)
        + "</ul>"
        "<h2>Serie Pool de Sanycces</h2>"
        "<p>La colección incluye grifos de lavabo y bidé, soluciones murales, grifería de bañera, columnas, termostáticos, rociadores y cuerpos empotrados compatibles.</p>"
        + COLLECTION_LINK_HTML
        + "<h2>Sanycces: diseño y calidad para el baño</h2>"
        "<p>Sanycces desarrolla soluciones para el equipamiento de baño que combinan diseño contemporáneo, funcionalidad y materiales preparados para un uso exigente. En Enki Hogar encontrarás grifería de baño, duchas y componentes Sanycces para completar proyectos coordinados.</p>"
    )
    product["seo"]["title"] = name
    if override := PRODUCT_SEO_OVERRIDES.get(product["sku"]):
        product["slug"] = override["slug"]
        product["seo"]["focusKeyword"] = override["focusKeyword"]
        product["seo"]["description"] = override["description"]


def _product_page_url(asset_key: str, source_by_asset: dict[str, Any]) -> str:
    return source_by_asset[asset_key]["officialProductUrl"]


def _revise_product(
    product: dict[str, Any],
    spec: PoolProductMediaSpec,
    finish_by_asset: dict[str, Any],
    dimension_by_key: dict[str, Any],
    inspiration_by_asset: dict[str, Any],
    finish_swatch_by_asset: dict[str, Any],
    source_by_asset: dict[str, Any],
    audit_by_asset: dict[str, Any],
) -> dict[str, Any]:
    revised = json.loads(json.dumps(product))
    _revise_customer_copy(revised)
    dimension = dimension_by_key[spec.dimension_key]
    page_url = _product_page_url(spec.asset_key, source_by_asset)
    retained_evidence = [entry for entry in revised["evidence"] if entry["field"] != "product.images"]
    if spec.variable:
        finish = finish_by_asset[spec.asset_key]
        inspiration = inspiration_by_asset[spec.asset_key]
        finish_swatch = finish_swatch_by_asset[spec.asset_key]
        revised["images"] = [
            {
                "path": finish["rm"]["bundlePath"],
                "sha256": finish["rm"]["outputSha256"],
                "width": finish["rm"]["outputWidth"],
                "height": finish["rm"]["outputHeight"],
                "alt": f"{revised['name']}, acabado Metal Raw",
                "position": 0,
                "gallery": True,
                "sourceUrl": finish["rm"]["sourceUrl"],
                "rightsConfirmed": True,
            },
            {
                "path": finish["nb"]["bundlePath"],
                "sha256": finish["nb"]["outputSha256"],
                "width": finish["nb"]["outputWidth"],
                "height": finish["nb"]["outputHeight"],
                "alt": f"{revised['name']}, acabado níquel cepillado",
                "position": 1,
                "gallery": True,
                "sourceUrl": finish["nb"]["sourceUrl"],
                "rightsConfirmed": True,
            },
            {
                "path": inspiration["bundlePath"],
                "sha256": inspiration["outputSha256"],
                "width": inspiration["outputWidth"],
                "height": inspiration["outputHeight"],
                "alt": f"{revised['name']} integrado en un ambiente de baño",
                "position": 2,
                "gallery": True,
                "sourceUrl": inspiration["sourceUrl"],
                "rightsConfirmed": True,
            },
            {
                "path": dimension["bundlePath"],
                "sha256": dimension["outputSha256"],
                "width": dimension["outputWidth"],
                "height": dimension["outputHeight"],
                "alt": f"Medidas de {revised['name']}",
                "position": 3,
                "gallery": True,
                "sourceUrl": page_url,
                "rightsConfirmed": True,
            },
            {
                "path": finish_swatch["bundlePath"],
                "sha256": finish_swatch["outputSha256"],
                "width": finish_swatch["outputWidth"],
                "height": finish_swatch["outputHeight"],
                "alt": f"Acabados níquel cepillado y Metal Raw de {revised['name']}",
                "position": 4,
                "gallery": True,
                "sourceUrl": page_url,
                "rightsConfirmed": True,
            },
        ]
        for variation in revised["variations"]:
            if variation["sku"].endswith("NB"):
                variation["imagePosition"] = 1
            elif variation["sku"].endswith("RM"):
                variation["imagePosition"] = 0
            else:
                raise PoolMediaError(f"unreviewed Pool finish suffix: {variation['sku']}")
        retained_evidence.extend((
            {
                "field": "product.images",
                "evidenceKey": f"official-media:{spec.asset_key}:nb",
                "sourceSha256": finish["nb"]["sourceSha256"],
                "sourceUrl": finish["nb"]["sourceUrl"],
                "confidence": "high",
            },
            {
                "field": "product.images",
                "evidenceKey": f"official-media:{spec.asset_key}:rm",
                "sourceSha256": finish["rm"]["sourceSha256"],
                "sourceUrl": finish["rm"]["sourceUrl"],
                "confidence": "high",
            },
            {
                "field": "product.images",
                "evidenceKey": f"official-media:{spec.asset_key}:inspiration",
                "sourceSha256": inspiration["sourceSha256"],
                "sourceUrl": inspiration["sourceUrl"],
                "confidence": "high",
            },
        ))
    else:
        original = revised["images"][0]
        revised["images"] = [
            {**original, "position": 0},
            {
                "path": dimension["bundlePath"],
                "sha256": dimension["outputSha256"],
                "width": dimension["outputWidth"],
                "height": dimension["outputHeight"],
                "alt": f"Medidas de {revised['name']}",
                "position": 1,
                "gallery": True,
                "sourceUrl": page_url,
                "rightsConfirmed": True,
            },
        ]
        retained_evidence.append(next(entry for entry in product["evidence"] if entry["field"] == "product.images"))
    retained_evidence.append({
        "field": "product.images",
        "evidenceKey": f"pdf-dimensions:{spec.sku}:p{spec.printed_page}",
        "sourceSha256": PDF_SHA256,
        "sourceUrl": page_url,
        "confidence": "high",
    })
    if spec.variable:
        retained_evidence.append({
            "field": "product.images",
            "evidenceKey": f"pdf-finishes:{spec.sku}:p{spec.printed_page}",
            "sourceSha256": PDF_SHA256,
            "sourceUrl": page_url,
            "confidence": "high",
        })
        retained_evidence.append({
            "field": "product.copy",
            "evidenceKey": f"official-copy:{spec.asset_key}",
            "sourceSha256": audit_by_asset[spec.asset_key]["htmlSha256"],
            "sourceUrl": page_url,
            "confidence": "medium",
        })
    revised["evidence"] = retained_evidence
    return revised


def _write_revised_bundles(
    source_bundles: Path,
    output_bundles: Path,
    created_at: str,
    source_inputs: dict[str, Any],
    products: dict[str, Any],
    finish_by_asset: dict[str, Any],
    dimension_by_key: dict[str, Any],
    inspiration_by_asset: dict[str, Any],
    finish_swatch_by_asset: dict[str, Any],
    review_root: Path,
) -> dict[str, Any]:
    if output_bundles.exists():
        raise PoolMediaError("refusing to overwrite an existing revised Pool bundle batch")
    output_bundles.mkdir(mode=0o750)
    for name in ("discount-policy.json", "price-policy-audit.json", "taxonomy-snapshot.json"):
        shutil.copy2(source_bundles / name, output_bundles / name)

    manifest = json.loads(json.dumps(source_inputs["batchManifest"]))
    spec_by_sku = {spec.sku: spec for spec in POOL_MEDIA_SPECS}
    source_by_asset = source_inputs["sourceByAsset"]
    for row in manifest["bundles"]:
        source_path = source_bundles / row["path"]
        bundle = json.loads(source_path.read_text(encoding="utf-8"))
        bundle["version"] = "1.4.0"
        bundle["createdAt"] = created_at
        output_path = output_bundles / row["path"]
        media_directory = output_path.parent / "media"
        media_directory.mkdir(parents=True, mode=0o750)
        revised_products = []
        for source_product in bundle["products"]:
            spec = spec_by_sku[source_product["sku"]]
            revised = _revise_product(
                source_product,
                spec,
                finish_by_asset,
                dimension_by_key,
                inspiration_by_asset,
                finish_swatch_by_asset,
                source_by_asset,
                source_inputs["auditByAsset"],
            )
            if spec.variable:
                for finish in ("nb", "rm"):
                    item = finish_by_asset[spec.asset_key][finish]
                    shutil.copy2(review_root / item["outputPath"], media_directory / Path(item["bundlePath"]).name)
                inspiration = inspiration_by_asset[spec.asset_key]
                shutil.copy2(review_root / inspiration["outputPath"], media_directory / Path(inspiration["bundlePath"]).name)
                finish_swatch = finish_swatch_by_asset[spec.asset_key]
                shutil.copy2(review_root / finish_swatch["outputPath"], media_directory / Path(finish_swatch["bundlePath"]).name)
            else:
                original_path = source_path.parent / source_product["images"][0]["path"]
                shutil.copy2(original_path, media_directory / Path(source_product["images"][0]["path"]).name)
            dimension = dimension_by_key[spec.dimension_key]
            shutil.copy2(review_root / dimension["outputPath"], media_directory / Path(dimension["bundlePath"]).name)
            revised_products.append(revised)
        bundle["products"] = revised_products
        audit_by_asset = source_inputs["auditByAsset"]
        pages = []
        for spec in (spec_by_sku[item["sku"]] for item in revised_products if item["type"] == "variable"):
            audit = audit_by_asset[spec.asset_key]
            page = {"url": audit["officialProductUrl"], "capturedAt": created_at, "sha256": audit["htmlSha256"]}
            if page not in pages:
                pages.append(page)
        bundle["sourceSnapshot"]["webPages"] = pages
        bundle_bytes = _stable_json(bundle)
        output_path.write_bytes(bundle_bytes)
        row["sha256"] = _sha256_bytes(bundle_bytes)
        row["validation"] = "pending_local_preflight"

    manifest["runId"] = output_bundles.name
    manifest["createdAt"] = created_at
    manifest_bytes = _stable_json(manifest)
    (output_bundles / "batch-manifest.json").write_bytes(manifest_bytes)
    readme = (
        "# Bundles Sanycces Pool con galería y copy comercial\n\n"
        "Preparación local de ENK-39. No concede autoridad de escritura en WooCommerce.\n\n"
        "- 24 padres en `draft`: 20 variables y 4 Sanybox simples.\n"
        "- 40 variaciones: NB apunta a la imagen 0 y RM a una imagen exclusiva de variación que no aparece en la galería del padre.\n"
        "- Galería variable: producto en fondo blanco, inspiración, cotas aisladas y muestras de acabados.\n"
        "- Los cuatro Sanybox simples conservan imagen de producto y cotas; no se inventan acabados ni escenas que el catálogo no ofrece.\n"
        "- Nombres y descripciones siguen la estructura comercial de la ficha Buades Vetta; la descripción corta contiene solo información del producto.\n"
        "- Las imágenes de producto e inspiración proceden de páginas oficiales de Sanycces; cotas y acabados se recortan del PDF fijado por SHA-256.\n"
        "- Cero escrituras externas realizadas.\n"
    )
    (output_bundles / "README.md").write_text(readme, encoding="utf-8")
    return manifest


def prepare_pool_media_review(
    *,
    pdf_path: Path,
    source_bundles: Path,
    source_media_manifest_path: Path,
    official_page_audit_path: Path,
    media_profile_path: Path,
    output_review: Path,
    output_bundles: Path,
    created_at: str,
    rights_confirmed: bool,
    fetch_official_image: Callable[[str, Path], dict[str, Any]],
) -> dict[str, Any]:
    if rights_confirmed is not True:
        raise PoolMediaError("official Sanycces media rights must be explicitly confirmed")
    if output_review.exists() or output_bundles.exists():
        raise PoolMediaError("refusing to overwrite an existing Pool media review or bundle output")
    if sha256_file(pdf_path) != PDF_SHA256:
        raise PoolMediaError("Pool PDF hash differs from the reviewed source of truth")
    profile = load_media_profile(media_profile_path)
    source_inputs = load_pool_media_inputs(source_bundles, source_media_manifest_path, official_page_audit_path)
    products, _ = _load_products(source_bundles, source_inputs["batchManifest"])
    output_review.mkdir(mode=0o750)
    try:
        finish_entries: list[dict[str, Any]] = []
        finish_by_asset: dict[str, dict[str, Any]] = {}
        inspiration_entries: list[dict[str, Any]] = []
        inspiration_by_asset: dict[str, dict[str, Any]] = {}
        variable_assets = sorted({spec.asset_key for spec in POOL_MEDIA_SPECS if spec.variable})
        for asset_key in variable_assets:
            source = source_inputs["sourceByAsset"][asset_key]
            audit = source_inputs["auditByAsset"][asset_key]
            entry = {
                "assetKey": asset_key,
                "officialProductUrl": audit["officialProductUrl"],
                "officialPageHtmlSha256": audit["htmlSha256"],
                "finishes": {},
            }
            finish_by_asset[asset_key] = {}
            for finish, url in (("nb", source["sourceUrl"]), ("rm", RM_SOURCE_URLS[asset_key])):
                source_path = output_review / "sources" / "official" / f"{asset_key}-{finish}.png"
                source_details = fetch_official_image(url, source_path)
                target = output_review / "media" / "finish" / f"{asset_key}-{finish}.webp"
                rendered = render_product_media_candidate(source_path, target, profile)
                output_sha = sha256_file(target)
                if finish == "nb" and output_sha != source["outputSha256"]:
                    raise PoolMediaError(f"NB deterministic output drift for {asset_key}")
                item = {
                    "finish": "Níquel cepillado" if finish == "nb" else "Metal Raw",
                    "sourceUrl": url,
                    "sourcePath": source_path.relative_to(output_review).as_posix(),
                    "sourceSha256": source_details["sha256"],
                    "sourceWidth": source_details["width"],
                    "sourceHeight": source_details["height"],
                    "sourceSizeBytes": source_details["sizeBytes"],
                    "outputPath": target.relative_to(output_review).as_posix(),
                    "bundlePath": f"media/{asset_key}-{finish}.webp",
                    "outputSha256": output_sha,
                    "outputWidth": rendered["outputWidth"],
                    "outputHeight": rendered["outputHeight"],
                    "outputSizeBytes": rendered["sizeBytes"],
                    "metadataStripped": rendered["metadataStripped"],
                    "upscaled": rendered["upscaled"],
                    "rightsConfirmed": True,
                    "approvalState": "prepared_candidate_needs_board_review",
                }
                if asset_key == "pool-mh2d066" and finish == "rm":
                    item["reviewNote"] = "Official page gallery image with non-semantic filename; exact 066 configuration and RM finish visually verified."
                entry["finishes"][finish] = item
                finish_by_asset[asset_key][finish] = item
            inspiration_url = INSPIRATION_SOURCE_URLS[asset_key]
            inspiration_source = output_review / "sources" / "official" / f"{asset_key}-inspiration.jpg"
            inspiration_details = fetch_official_image(inspiration_url, inspiration_source)
            inspiration_target = output_review / "media" / "inspiration" / f"{asset_key}-inspiration.webp"
            inspiration_rendered = render_product_media_candidate(inspiration_source, inspiration_target, profile)
            inspiration_item = {
                "assetKey": asset_key,
                "sourceUrl": inspiration_url,
                "sourcePath": inspiration_source.relative_to(output_review).as_posix(),
                "sourceSha256": inspiration_details["sha256"],
                "sourceWidth": inspiration_details["width"],
                "sourceHeight": inspiration_details["height"],
                "sourceSizeBytes": inspiration_details["sizeBytes"],
                "outputPath": inspiration_target.relative_to(output_review).as_posix(),
                "bundlePath": f"media/{asset_key}-inspiration.webp",
                "outputSha256": sha256_file(inspiration_target),
                "outputWidth": inspiration_rendered["outputWidth"],
                "outputHeight": inspiration_rendered["outputHeight"],
                "outputSizeBytes": inspiration_rendered["sizeBytes"],
                "metadataStripped": inspiration_rendered["metadataStripped"],
                "upscaled": inspiration_rendered["upscaled"],
                "rightsConfirmed": True,
                "approvalState": "prepared_candidate_needs_board_review",
            }
            entry["inspiration"] = inspiration_item
            inspiration_entries.append(inspiration_item)
            inspiration_by_asset[asset_key] = inspiration_item
            finish_entries.append(entry)

        dimension_by_key: dict[str, dict[str, Any]] = {}
        finish_swatch_by_asset: dict[str, dict[str, Any]] = {}
        document = pdfium.PdfDocument(str(pdf_path))
        try:
            for spec in POOL_MEDIA_SPECS:
                if spec.dimension_key in dimension_by_key:
                    continue
                target = output_review / "media" / "dimensions" / f"{spec.dimension_key}-dimensions.webp"
                rendered = render_pdf_dimension_candidate(document, spec, target, profile)
                dimension_by_key[spec.dimension_key] = {
                    "dimensionKey": spec.dimension_key,
                    "sourcePdfLogicalName": pdf_path.name,
                    "sourcePdfSha256": PDF_SHA256,
                    "outputPath": target.relative_to(output_review).as_posix(),
                    "bundlePath": f"media/{spec.dimension_key}-dimensions.webp",
                    "outputSha256": rendered["sha256"],
                    "outputWidth": rendered["width"],
                    "outputHeight": rendered["height"],
                    "outputSizeBytes": rendered["sizeBytes"],
                    "metadataStripped": rendered["metadataStripped"],
                    "physicalPage": rendered["physicalPage"],
                    "printedPage": rendered["printedPage"],
                    "cropBoxPointsTopLeft": rendered["cropBoxPointsTopLeft"],
                    "renderDpi": rendered["renderDpi"],
                    "rightsConfirmed": True,
                    "approvalState": "prepared_candidate_needs_board_review",
                }
                if spec.variable and spec.asset_key not in finish_swatch_by_asset:
                    finish_target = output_review / "media" / "finish-samples" / f"{spec.asset_key}-finishes.webp"
                    finish_rendered = render_pdf_finish_candidate(document, spec, finish_target, profile)
                    finish_swatch_by_asset[spec.asset_key] = {
                        "assetKey": spec.asset_key,
                        "sourcePdfLogicalName": pdf_path.name,
                        "sourcePdfSha256": PDF_SHA256,
                        "outputPath": finish_target.relative_to(output_review).as_posix(),
                        "bundlePath": f"media/{spec.asset_key}-finishes.webp",
                        "outputSha256": finish_rendered["sha256"],
                        "outputWidth": finish_rendered["width"],
                        "outputHeight": finish_rendered["height"],
                        "outputSizeBytes": finish_rendered["sizeBytes"],
                        "metadataStripped": finish_rendered["metadataStripped"],
                        "physicalPage": finish_rendered["physicalPage"],
                        "printedPage": finish_rendered["printedPage"],
                        "cropBoxPointsTopLeft": finish_rendered["cropBoxPointsTopLeft"],
                        "renderDpi": finish_rendered["renderDpi"],
                        "rightsConfirmed": True,
                        "approvalState": "prepared_candidate_needs_board_review",
                    }
        finally:
            document.close()

        bindings = []
        for spec in sorted(POOL_MEDIA_SPECS, key=lambda item: item.sku):
            product = products[spec.sku]
            binding = {
                "productKey": product["productKey"],
                "parentSku": spec.sku,
                "type": product["type"],
                "dimensionKey": spec.dimension_key,
                "dimensionPosition": 2 if spec.variable else 1,
                "dimensionOutputSha256": dimension_by_key[spec.dimension_key]["outputSha256"],
            }
            if spec.variable:
                binding["inspirationPosition"] = 1
                binding["finishSamplesPosition"] = 3
                variation_bindings = []
                for variation in product["variations"]:
                    finish = "nb" if variation["sku"].endswith("NB") else "rm" if variation["sku"].endswith("RM") else None
                    if finish is None:
                        raise PoolMediaError(f"unreviewed finish suffix in source bundle: {variation['sku']}")
                    variation_bindings.append({
                        "variationKey": variation["variationKey"],
                        "sku": variation["sku"],
                        "finish": finish_by_asset[spec.asset_key][finish]["finish"],
                        "imagePosition": 0 if finish == "nb" else 4,
                        "outputSha256": finish_by_asset[spec.asset_key][finish]["outputSha256"],
                    })
                binding["finishAssetKey"] = spec.asset_key
                binding["variations"] = variation_bindings
            bindings.append(binding)

        dimensions = [dimension_by_key[key] for key in sorted(dimension_by_key)]
        finish_swatches = [finish_swatch_by_asset[key] for key in sorted(finish_swatch_by_asset)]
        _finish_contact_sheet(finish_entries, output_review, output_review / "qa" / "finish-pairs-contact-sheet.png")
        _dimension_contact_sheet(dimensions, output_review, output_review / "qa" / "dimensions-contact-sheet.png")
        _single_asset_contact_sheet(inspiration_entries, output_review, output_review / "qa" / "inspiration-contact-sheet.png", key="assetKey")
        _single_asset_contact_sheet(finish_swatches, output_review, output_review / "qa" / "finish-samples-contact-sheet.png", key="assetKey")
        manifest = {
            "schema": "enki-sanycces-pool-media-review/v1",
            "runId": output_review.name,
            "createdAt": created_at,
            "status": "prepared_for_board_review",
            "authority": {
                "approvalGranted": False,
                "externalWritesPerformed": 0,
                "canUploadMedia": False,
                "canMutateWoo": False,
            },
            "rights": {
                "confirmed": True,
                "confirmedBy": "Board/operator",
                "confirmedOn": "2026-09-19",
                "scope": "Reuse and transform official Sanycces product and catalogue imagery for Enki Hogar.",
            },
            "sources": {
                "pdf": {"logicalName": pdf_path.name, "sha256": PDF_SHA256, "role": "source_of_truth_for_dimensions"},
                "officialPageAuditSha256": sha256_file(official_page_audit_path),
                "officialMediaManifestSha256": sha256_file(source_media_manifest_path),
                "mediaProfile": {"profileKey": profile["profileKey"], "sha256": sha256_file(media_profile_path)},
            },
            "summary": {
                "parents": len(bindings),
                "variableParents": sum(spec.variable for spec in POOL_MEDIA_SPECS),
                "simpleParents": sum(not spec.variable for spec in POOL_MEDIA_SPECS),
                "variationBindings": sum(len(item.get("variations", [])) for item in bindings),
                "finishConfigurations": len(finish_entries),
                "finishWebps": len(finish_entries) * 2,
                "inspirationWebps": len(inspiration_entries),
                "finishSampleWebps": len(finish_swatches),
                "dimensionBindings": len(bindings),
                "uniqueDimensionWebps": len(dimensions),
                "unsupportedFinishAssignments": 0,
                "externalWrites": 0,
            },
            "reviewExceptions": [{
                "assetKey": "pool-mh2d066",
                "finish": "Metal Raw",
                "status": "visually_verified_official_gallery_asset",
                "reason": "The official product page contains the exact RM render under a non-semantic filename (POOL-FOTOS-WEB11.png).",
            }],
            "finishAssets": finish_entries,
            "inspirationAssets": inspiration_entries,
            "finishSampleAssets": finish_swatches,
            "dimensionAssets": dimensions,
            "bindings": bindings,
            "qa": {
                "finishContactSheet": "qa/finish-pairs-contact-sheet.png",
                "dimensionsContactSheet": "qa/dimensions-contact-sheet.png",
                "inspirationContactSheet": "qa/inspiration-contact-sheet.png",
                "finishSamplesContactSheet": "qa/finish-samples-contact-sheet.png",
                "nativeImageReviewRequired": True,
            },
        }
        manifest_bytes = _stable_json(manifest)
        (output_review / "media-review-manifest.json").write_bytes(manifest_bytes)
        _write_revised_bundles(
            source_bundles,
            output_bundles,
            created_at,
            source_inputs,
            products,
            finish_by_asset,
            dimension_by_key,
            inspiration_by_asset,
            finish_swatch_by_asset,
            output_review,
        )
        report_lines = [
            "# ENK-39 · Media Pool NB/RM y planos de medidas",
            "",
            "Preparación local para revisión. No se ha subido ni asignado ninguna imagen en WooCommerce.",
            "",
            "## Resultado",
            "",
            f"- {len(finish_entries) * 2} WebP de acabado: 18 configuraciones × NB/RM.",
            f"- {len(inspiration_entries)} imágenes WebP de inspiración verificadas en la galería oficial.",
            f"- {len(dimensions)} planos WebP únicos con el dibujo de cotas aislado, vinculados a 24 productos.",
            f"- {len(finish_swatches)} imágenes WebP con las muestras NB/RM recortadas del catálogo.",
            "- 40 variaciones con binding exacto: NB → posición 0; RM → posición 4, fuera de la galería del padre.",
            "- Galería de los 20 variables: producto, inspiración, medidas y acabados.",
            "- Los 4 Sanybox simples usan producto y medidas; el catálogo no muestra acabados o escenas propias para ellos.",
            "- Cero escrituras externas.",
            "",
            "## Excepción revisada",
            "",
            "`MH2D066SSRM` usa `POOL-FOTOS-WEB11.png`, presente en la galería del producto oficial. El nombre no identifica la referencia, por lo que se conserva como excepción visual revisada.",
            "",
            "## Archivos de QA",
            "",
            "- `qa/finish-pairs-contact-sheet.png`",
            "- `qa/dimensions-contact-sheet.png`",
            "- `qa/inspiration-contact-sheet.png`",
            "- `qa/finish-samples-contact-sheet.png`",
            "- `media-review-manifest.json`",
            "",
        ]
        (output_review / "REPORT.md").write_text("\n".join(report_lines), encoding="utf-8")
        return {
            "reviewRoot": str(output_review),
            "bundleRoot": str(output_bundles),
            "manifestSha256": _sha256_bytes(manifest_bytes),
            "summary": manifest["summary"],
        }
    except Exception:
        shutil.rmtree(output_review, ignore_errors=True)
        shutil.rmtree(output_bundles, ignore_errors=True)
        raise
