"""Versioned brand adapter implementations."""

from .buades import extract as extract_buades
from .chicandbath import extract as extract_chicandbath
from .enki_espejos import extract as extract_enki_espejos
from .mundilite import extract as extract_mundilite

IMPLEMENTATIONS = {
    "buades_v1": extract_buades,
    "enki_espejos_v1": extract_enki_espejos,
    "mundilite_v1": extract_mundilite,
    "chicandbath_v1": extract_chicandbath,
}

__all__ = ["IMPLEMENTATIONS"]
