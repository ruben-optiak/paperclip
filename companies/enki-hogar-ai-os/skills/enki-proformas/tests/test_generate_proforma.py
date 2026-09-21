from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timezone
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "generate_proforma.py"
SPEC = importlib.util.spec_from_file_location("generate_proforma", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class GenerateProformaTests(unittest.TestCase):
    def setUp(self) -> None:
        fixture_dir = Path(__file__).parents[1] / "fixtures"
        self.request_raw = json.loads((fixture_dir / "proforma-request.sanitized.json").read_text(encoding="utf-8"))
        self.company_raw = json.loads((fixture_dir / "company-config.sanitized.json").read_text(encoding="utf-8"))

    def test_calculation_is_decimal_and_vat_is_contained_in_discounted_total(self) -> None:
        request = MODULE.validate_request(self.request_raw)
        totals = MODULE.calculate_totals(request)
        self.assertEqual(totals.strings(), {
            "subtotal_net": "599.18",
            "line_discount_net": "13.92",
            "global_discount_net": "58.53",
            "total_discount_net": "72.45",
            "shipping_net": "12.10",
            "taxable_base": "526.73",
            "vat": "110.61",
            "total_gross": "649.44",
        })
        self.assertEqual(
            totals.subtotal_net - totals.line_discount_net - totals.global_discount_net,
            totals.taxable_base,
        )
        self.assertEqual(totals.taxable_base + totals.vat + totals.shipping_net, totals.total_gross)

    def test_generated_number_is_sortable_and_uses_madrid_time(self) -> None:
        instant = datetime(2026, 1, 2, 22, 4, 5, 678901, tzinfo=timezone.utc)
        self.assertEqual(MODULE.generate_proforma_number(instant), "1767391445")
        self.assertRegex(MODULE.generate_proforma_number(instant), r"^[0-9]{10}$")

    def test_unknown_customer_fields_and_payment_identifiers_fail_closed(self) -> None:
        self.request_raw["customer"]["billing"]["cardNumber"] = "4111111111111111"
        with self.assertRaisesRegex(MODULE.ValidationError, "campos no permitidos"):
            MODULE.validate_request(self.request_raw)

    def test_company_accepts_a_complete_legal_notice_but_keeps_a_hard_limit(self) -> None:
        self.company_raw["privacyText"] = "Texto legal de demostración. " * 40
        self.assertGreater(len(self.company_raw["privacyText"]), 700)
        self.assertEqual(MODULE.validate_company(self.company_raw)["privacyText"], self.company_raw["privacyText"].strip())
        self.company_raw["privacyText"] = "x" * 1601
        with self.assertRaisesRegex(MODULE.ValidationError, "entre 1 y 1600"):
            MODULE.validate_company(self.company_raw)

    def test_final_requires_exact_hash_and_non_demo_company(self) -> None:
        request = MODULE.validate_request(self.request_raw)
        digest = MODULE.request_sha256(self.request_raw)
        self.assertEqual(MODULE.expected_output_name(request, digest, "draft"), f"proforma-borrador-{digest[:12]}.pdf")
        self.assertEqual(
            MODULE.expected_output_name(request, digest, "draft", final_appearance=True),
            f"proforma-revision-{digest[:12]}.pdf",
        )
        self.assertTrue(MODULE.validate_company(self.company_raw)["demoMode"])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path = root / "request.json"
            company_path = root / "company.json"
            request_path.write_text(json.dumps(self.request_raw), encoding="utf-8")
            company_path.write_text(json.dumps(self.company_raw), encoding="utf-8")
            final_name = MODULE.expected_output_name(request, digest, "final")
            with redirect_stderr(io.StringIO()):
                result = MODULE.main([
                    "--request", str(request_path),
                    "--company-config", str(company_path),
                    "--output", str(root / final_name),
                    "--mode", "final",
                    "--authorization-sha256", digest,
                ])
            self.assertEqual(result, 2)

            self.company_raw["demoMode"] = False
            company_path.write_text(json.dumps(self.company_raw), encoding="utf-8")
            with redirect_stderr(io.StringIO()):
                result = MODULE.main([
                    "--request", str(request_path),
                    "--company-config", str(company_path),
                    "--output", str(root / final_name),
                    "--mode", "final",
                    "--authorization-sha256", "0" * 64,
                ])
            self.assertEqual(result, 2)
            self.assertFalse((root / final_name).exists())

    @unittest.skipUnless(importlib.util.find_spec("reportlab"), "ReportLab no está disponible en este runtime")
    def test_final_appearance_hides_draft_marks_without_authorizing_final(self) -> None:
        request = MODULE.validate_request(self.request_raw)
        company = MODULE.validate_company(self.company_raw)
        digest = MODULE.request_sha256(self.request_raw)
        totals = MODULE.calculate_totals(request)
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "preview.pdf"
            MODULE.render_pdf(request, company, totals, pdf, "draft", digest, final_appearance=True)
            import pdfplumber
            with pdfplumber.open(pdf) as document:
                text = "\n".join(page.extract_text() or "" for page in document.pages)
            self.assertIn("PROFORMA", text)
            self.assertNotIn("BORRADOR", text)
            self.assertNotIn("CONFIGURACIÓN DE DEMOSTRACIÓN", text)

    def test_receipt_excludes_customer_pii(self) -> None:
        request = MODULE.validate_request(self.request_raw)
        company = MODULE.validate_company(self.company_raw)
        digest = MODULE.request_sha256(self.request_raw)
        totals = MODULE.calculate_totals(request)
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "dummy.pdf"
            pdf.write_bytes(b"not-a-real-pdf")
            receipt = MODULE.receipt_payload(request, company, totals, "draft", digest, pdf)
        encoded = json.dumps(receipt, ensure_ascii=False)
        for sensitive in ["Cliente de Demostración", "B00000000", "compras@example.invalid", "600 000 000", "Calle Ejemplo"]:
            self.assertNotIn(sensitive, encoded)
        self.assertEqual(receipt["externalWrites"], 0)
        self.assertFalse(receipt["messageSent"])

    @unittest.skipUnless(importlib.util.find_spec("reportlab"), "ReportLab no está disponible en este runtime")
    def test_rendered_pdf_is_byte_deterministic(self) -> None:
        request = MODULE.validate_request(self.request_raw)
        company = MODULE.validate_company(self.company_raw)
        digest = MODULE.request_sha256(self.request_raw)
        totals = MODULE.calculate_totals(request)
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.pdf"
            second = Path(directory) / "second.pdf"
            MODULE.render_pdf(request, company, totals, first, "draft", digest)
            MODULE.render_pdf(request, company, totals, second, "draft", digest)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            import pdfplumber
            with pdfplumber.open(first) as document:
                text = "\n".join(page.extract_text() or "" for page in document.pages)
                self.assertEqual(len(document.pages), 1)
                total_word = next(word for word in document.pages[0].extract_words() if word["text"] == "649,44")
                content_right = document.pages[0].width - 18 * 72 / 25.4
                self.assertLessEqual(total_word["x1"], content_right)
            for expected in ["PRECIO UNIDAD", "PRECIO TOTAL", "DTO", "IVA", "Descuento", "TOTAL (IVA INCLUIDO)", "Protección de datos", "DEMO-SOPORTE-005"]:
                self.assertIn(expected, text)
            self.assertNotIn("Descuento en líneas", text)
            self.assertNotIn("Descuento general", text)
            self.assertNotIn(" BASE\n", text)
            self.assertIn("ENKI HOGAR", text)
            self.assertEqual(text.count("Oferta válida hasta"), 1)
            self.assertNotIn("Entrega estimada", text)
            self.assertIn(f"{request['customer']['billing']['name']} - {request['proformaNumber']}", text)


if __name__ == "__main__":
    unittest.main()
