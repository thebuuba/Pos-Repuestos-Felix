"""Pruebas con archivos sintéticos. El modo --fixture solo crea la entrada del test JS."""
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
PREPARE = ROOT / "scripts/netpos/prepare.py"
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
HEAD = "ARTICULO DESCRIPCION UNIDAD CATEGORIA MARCA COSTO PRECIO PRECIO2 PRECIO3 EXISTENCIA MINIMO NOTIFICAR_MINIMO UBICACION IMPUESTOS ACTIVO EXTRA".split()


def table(folder, name, headers, rows):
    with (folder / (name + ".csv")).open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(headers.split())
        writer.writerows(rows)


def fixture(folder, codes=None, history=None, cost="12.345600000000001", formula=False):
    folder.mkdir(exist_ok=True)
    if codes is None:
        codes = [("n", "12"), ("n", "45139"), ("n", "1234567890123450"),
                 ("s", "ABC "), ("s", "abc")]
    if history is None:
        history = ["0012 ", "08-2023", "1234567890123451", "ABC ", "abc"]
    table(folder, "KARDEX", "ARTICULO EXISTENCIA", [(key, "999") for key in history])
    table(folder, "PAGOS", "TARJETA NOTA", [["PRIVADO-SINTETICO", 'texto,"á"\r\nsegunda línea'], ["", ""]])
    for name, field in [("CATEGORIAS", "CATEGORIA"), ("UBICACIONES", "UBICACION"),
                        ("MARCAS", "MARCA"), ("UNIDADES", "UNIDAD")]:
        table(folder, name, field + " DESCRIPCION ACTIVO", [["1", "Opción " + field, "True"]])
    table(folder, "CLIENTES", "CLIENTE NOMBRE_CLIENTE RNC TELEFONO EMAIL DIRECCION ACTIVO LIMITE_CREDITO",
          [["1", "Cliente Contado", "", "01", "", "", "True", "0"]])
    table(folder, "SUPLIDORES", "SUPLIDOR NOMBRE_SUPLIDOR RNC TELEFONO EMAIL CONTACTO ACTIVO",
          [["1", "Suplidor de prueba", "", "", "", "", "True"]])
    table(folder, "EMPRESA", "NOMBRE_EMPRESA RNC TELEFONO EMAIL DIRECCION IMPUESTOS_INCLUIDOS ITBIS",
          [["Negocio de prueba", "", "", "", "", "True", "18"]])
    sheet = ET.Element("worksheet", xmlns=NS)
    data = ET.SubElement(sheet, "sheetData")
    strings = []
    def row(number, fields):
        line = ET.SubElement(data, "row", r=str(number))
        for i, (kind, value) in enumerate(fields):
            cell = ET.SubElement(line, "c", r=chr(65+i)+str(number), t=kind)
            if number > 1 and i == 0 and value == "45139":
                cell.set("s", "1")
            if formula and number == 2 and i == 5:
                ET.SubElement(cell, "f").text = "1+1"
            if kind == "s":
                strings.append(value)
                value = str(len(strings)-1)
            ET.SubElement(cell, "v").text = value
    row(1, [("s", c) for c in HEAD])
    for idx, code in enumerate(codes, 2):
        row(idx, [code, ("s", "Pieza á"), *[("n", "1")]*3, ("n", cost), ("n", "0"),
                  ("n", "10.003"), ("n", "1.25"), ("n", "0.25" if idx == 2 else "0"),
                  ("n", "0.50"), ("s", "False"), ("n", "1"), ("s", "False"),
                  ("s", "True"), ("s", "extra privado")])
    shared = ET.Element("sst", xmlns=NS)
    for string in strings:
        ET.SubElement(ET.SubElement(shared, "si"), "t").text = string
    with ZipFile(folder / "productos.csv.xlsx", "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", ET.tostring(sheet, encoding="utf-8"))
        z.writestr("xl/sharedStrings.xml", ET.tostring(shared, encoding="utf-8"))
        z.writestr("xl/workbook.xml", f'<workbook xmlns="{NS}" xmlns:r="{REL}"><sheets><sheet name="Datos" r:id="r1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/styles.xml", f'<styleSheet xmlns="{NS}"><cellXfs><xf numFmtId="0"/><xf numFmtId="17"/></cellXfs></styleSheet>')


class Preparation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.out = self.root / "source", self.root / "package"

    def run_prepare(self, success, out=None):
        self.assertTrue(PREPARE.is_file(), "Falta el preparador NetPOS")
        run = subprocess.run([sys.executable, PREPARE, "--source", self.source, "--output", out or self.out],
                             capture_output=True, text=True)
        self.assertEqual(run.returncode == 0, success, run.stdout + run.stderr)
        if not success:
            self.assertFalse((out or self.out).exists())
        return run

    def test_archive_and_map_exact_codes(self):
        fixture(self.source)
        self.run_prepare(True)
        manifest = json.loads((self.out / "manifest.json").read_text("utf-8"))
        self.assertEqual(manifest["format"], 2)
        self.assertEqual((self.out/"archive.bin").read_bytes()[:11], b"PGCOPY\n\xff\r\n\0")
        self.assertEqual(len(manifest["sources"]), 10)
        for name, digest in manifest["artifacts"].items():
            self.assertEqual(hashlib.sha256((self.out / name).read_bytes()).hexdigest(), digest)
        with (self.out / "products.csv").open(encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual([r["codigo"] for r in rows], ["0012","08-2023","1234567890123451","ABC ","abc"])
        self.assertEqual((rows[0]["costo"],rows[0]["precio2"]), ("12.3456","10.0030"))
        self.assertEqual(json.loads(rows[0]["original"])["EXTRA"]["valor"], "extra privado")
        other = self.root / "other"
        with (self.source / "PAGOS.csv").open("a", encoding="utf-8") as f:
            f.write("otro,valor\n")
        self.run_prepare(True, other)
        self.assertNotEqual(manifest["fingerprint"], json.loads((other/"manifest.json").read_text("utf-8"))["fingerprint"])

    def test_unconfirmed_padding_remains_observed(self):
        fixture(self.source, [("s","0001"),("n","2"),("s","0003")], [])
        self.run_prepare(True)
        with (self.out/"products.csv").open(encoding="utf-8",newline="") as f:
            unknown = list(csv.DictReader(f))[1]
        self.assertEqual((unknown["codigo"],unknown["sugerencia"]),("2","0002"))

    def test_rejects_ambiguity_order_collision_and_scale(self):
        for codes, hist, cost in [
            ([("n","2")],["02","002"],"0"), ([("s","Z"),("s","A")],[],"0"),
            ([("s","A"),("s","A")],[],"0"), ([("s","A")],[],"1.12345")]:
            with self.subTest(codes=codes, cost=cost):
                fixture(self.source, codes, hist, cost)
                self.run_prepare(False)

    def test_rejects_bad_headers_formulas_and_public_path(self):
        fixture(self.source, formula=True)
        self.run_prepare(False)
        fixture(self.source)
        self.run_prepare(False, ROOT/"public/test-netpos-private")
        shared = self.root / "public"
        shared.mkdir()
        self.run_prepare(False, shared/"salida")
        table(self.source,"PAGOS","VALOR VALOR",[["1","2"]])
        self.run_prepare(False)
        fixture(self.source)
        table(self.source, "EMPRESA", "NOMBRE_EMPRESA RNC TELEFONO EMAIL DIRECCION IMPUESTOS_INCLUIDOS ITBIS",
              [["Prueba", "", "", "", "", "False", "18"]])
        self.run_prepare(False)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture":
        fixture(Path(sys.argv[2]))
    else:
        unittest.main()
