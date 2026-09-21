from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from enki_catalog_pipeline.sanycces_tariff import SanyccesTariffError, read_sanycces_price_tariff


SHARED_STRINGS = """<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Código</t></si><si><t>Descripción</t></si><si><t>PVP</t></si><si><t>ean</t></si>
  <si><t>PVPNA</t></si><si><t>MNO006SSNB</t></si><si><t>Pool NB</t></si><si><t>8435315500001</t></si>
  <si><t>MNO006SSRM</t></si><si><t>Pool RM</t></si><si><t>8435315500002</t></si>
  <si><t>No se han aplicado filtros</t></si>
</sst>"""

WORKBOOK = """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"""

RELS = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
</Relationships>"""


def worksheet(*, duplicate: bool = False, formula: bool = False) -> str:
    second_reference = 5 if duplicate else 8
    second_price = '<f>1+1</f><v>257</v>' if formula else "<v>257</v>"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <dimension ref="A1:E5"/><sheetData>
  <row r="1"><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c><c r="E1" t="s"><v>3</v></c></row>
  <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2"><v>210</v></c><c r="E2" t="s"><v>7</v></c></row>
  <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>{second_reference}</v></c><c r="C3" t="s"><v>9</v></c><c r="D3">{second_price}</c><c r="E3" t="s"><v>10</v></c></row>
  <row r="4"><c r="E4" t="s"><v>11</v></c></row>
  <row r="5"><c r="B5" t="s"><v>11</v></c></row>
 </sheetData>
</worksheet>"""


def write_fixture(path: Path, *, duplicate: bool = False, formula: bool = False) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", WORKBOOK)
        archive.writestr("xl/_rels/workbook.xml.rels", RELS)
        archive.writestr("xl/sharedStrings.xml", SHARED_STRINGS)
        archive.writestr("xl/worksheets/sheet1.xml", worksheet(duplicate=duplicate, formula=formula))


class SanyccesTariffTest(unittest.TestCase):
    def test_reads_unique_unfiltered_pvp_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "tariff.xlsx"
            write_fixture(path)
            tariff = read_sanycces_price_tariff(path)
        self.assertEqual(tariff["sheetName"], "Hoja1")
        self.assertEqual(len(tariff["records"]), 2)
        self.assertEqual(tariff["records"][0]["reference"], "MNO006SSNB")
        self.assertEqual(str(tariff["records"][1]["pvpExVat"]), "257")
        self.assertEqual(tariff["records"][1]["eanStatus"], "valid_or_blank")

    def test_rejects_duplicate_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "tariff.xlsx"
            write_fixture(path, duplicate=True)
            with self.assertRaisesRegex(SanyccesTariffError, "unique"):
                read_sanycces_price_tariff(path)

    def test_rejects_formula_price(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "tariff.xlsx"
            write_fixture(path, formula=True)
            with self.assertRaisesRegex(SanyccesTariffError, "fixed source values"):
                read_sanycces_price_tariff(path)


if __name__ == "__main__":
    unittest.main()
