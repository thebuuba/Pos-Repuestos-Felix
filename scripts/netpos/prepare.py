"""Prepara una exportación NetPOS UTF-8 sin conectarse a ninguna base."""
import argparse
import base64
import csv
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_EVEN, localcontext
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from xml.etree import ElementTree as ET
from zipfile import ZipFile, BadZipFile

REPO = Path(__file__).resolve().parents[2]
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
IDENT = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,62}\Z")
CHOICES = {"CATEGORIAS": ("CATEGORIA", "categorias"), "MARCAS": ("MARCA", "marcas"),
           "UBICACIONES": ("UBICACION", "ubicaciones"), "UNIDADES": ("UNIDAD", "unidades")}
REQUIRED = {name: [key, "DESCRIPCION"] for name, (key, _) in CHOICES.items()}
REQUIRED.update({
    "EMPRESA": "NOMBRE_EMPRESA RNC TELEFONO EMAIL DIRECCION IMPUESTOS_INCLUIDOS ITBIS".split(),
    "CLIENTES": "CLIENTE NOMBRE_CLIENTE RNC DIRECCION TELEFONO EMAIL LIMITE_CREDITO ACTIVO".split(),
    "SUPLIDORES": "SUPLIDOR NOMBRE_SUPLIDOR RNC TELEFONO EMAIL CONTACTO ACTIVO".split()
})
PRODUCT_FIELDS = "ARTICULO DESCRIPCION CATEGORIA MARCA UBICACION UNIDAD COSTO PRECIO PRECIO2 PRECIO3 EXISTENCIA MINIMO NOTIFICAR_MINIMO IMPUESTOS ACTIVO".split()
PRODUCT_COLUMNS = "fila codigo_original codigo evidencia sugerencia original nombre costo precio1 precio2 precio3 stock stock_minimo notificar_minimo gravado activo categoria marca ubicacion".split()


class Invalid(Exception):
    """Solo contiene descripciones de esquema o números de fila, nunca datos privados."""


def require(ok, message):
    if not ok:
        raise Invalid(message)


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def headers_ok(header, required):
    require(header and all(IDENT.fullmatch(h) for h in header)
            and len(header) == len(set(h.lower() for h in header)), "Encabezado inválido o duplicado.")
    require(set(required) <= set(header), "Faltan columnas requeridas.")


def writer(file):
    # Las comillas conservan los campos vacíos como texto durante COPY CSV.
    return csv.writer(file, quoting=csv.QUOTE_ALL)


def read_history(path, output, keys):
    table = path.stem.upper()
    retained = []
    count = 0
    with path.open(encoding="utf-8-sig", newline="") as source, output.open("w", encoding="utf-8", newline="") as out:
        reader = csv.reader(source, strict=True)
        columns = next(reader, [])
        headers_ok(columns, REQUIRED.get(table, []))
        article = columns.index("ARTICULO") if "ARTICULO" in columns else None
        history = writer(out)
        for count, row in enumerate(reader, 1):
            require(len(row) == len(columns) and all("\x00" not in v for v in row),
                    f"Fila CSV inválida en {table}, registro {count}.")
            history.writerow([count, *row])
            if article is not None and (key := row[article].rstrip(" ")):
                keys.add(key)
            if table in REQUIRED:
                retained.append(dict(zip(columns, row)))
    return columns, count, retained


def xlsx(path):
    def string(item):
        return "".join(t.text or "" for t in [*item.findall(NS+"t"), *item.findall(NS+"r/"+NS+"t")])
    with ZipFile(path) as book:
        require(sum(f.file_size for f in book.infolist()) <= 250 * 1024**2, "Libro demasiado grande.")
        require(len(book.namelist()) == len(set(book.namelist())), "Partes XLSX duplicadas.")
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        props = workbook.find(NS+"workbookPr")
        require(props is None or props.get("date1904","0") in ("0","false"), "Calendario XLSX no admitido.")
        sheets = workbook.findall(NS+"sheets/"+NS+"sheet")
        require(len(sheets) == 1, "Se requiere una hoja de artículos.")
        relations = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        targets = [r.get("Target") for r in relations if r.get("Id") == sheets[0].get(RID)
                   and r.get("Type","").endswith("/worksheet") and not r.get("TargetMode")]
        require(len(targets) == 1, "Hoja XLSX inválida.")
        member = targets[0].lstrip("/") if targets[0].startswith("/") else "xl/"+targets[0]
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            strings = [string(i) for i in ET.fromstring(book.read("xl/sharedStrings.xml")).findall(NS+"si")]
        formats = ["0"]
        if "xl/styles.xml" in book.namelist():
            formats = [x.get("numFmtId","0") for x in ET.fromstring(book.read("xl/styles.xml")).findall(NS+"cellXfs/"+NS+"xf")]
        tree = ET.fromstring(book.read(member))
        rows, columns, last = [], {}, 0
        for row in tree.findall(NS+"sheetData/"+NS+"row"):
            number = int(row.attrib["r"])
            require(number > last, "Orden de filas XLSX inválido.")
            last = number
            cells = {}
            for cell in row.findall(NS+"c"):
                ref = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", cell.attrib["r"])
                require(ref and int(ref[2]) == number and ref[1] not in cells, f"Celda inválida en fila {number}.")
                kind = cell.get("t","n")
                require(cell.find(NS+"f") is None and kind in ("n","s","inlineStr","b"), f"Fórmula o tipo no admitido en fila {number}.")
                raw = cell.findtext(NS+"v","")
                style = int(cell.get("s","0"))
                require(0 <= style < len(formats), "Estilo XLSX inválido.")
                if kind == "s":
                    require(raw.isdecimal() and int(raw) < len(strings), "Índice XLSX inválido.")
                    value = strings[int(raw)]
                elif kind == "inlineStr":
                    value = string(cell.find(NS+"is"))
                else:
                    value = raw
                cells[ref[1]] = {"valor": value, "tipo": kind, "estilo": style}
            if not columns:
                columns = {col: c["valor"] for col,c in cells.items()}
                headers_ok(list(columns.values()), PRODUCT_FIELDS)
            else:
                require(cells.keys() <= columns.keys(), f"Columna XLSX sin encabezado, fila {number}.")
                values = {name: cells.get(col, {"valor":"","tipo":"","estilo":0}) for col,name in columns.items()}
                article = values["ARTICULO"]
                require(article["tipo"] in ("n","s","inlineStr") and article["valor"].strip(), f"Artículo sin código, fila {number}.")
                rows.append((number, values, formats[article["estilo"]] in ("14","15","16","17","22")))
        require(bool(rows), "Libro sin artículos.")
        return list(columns.values()), rows


def signature(value, rounding=ROUND_HALF_EVEN):
    try:
        n = Decimal(value)
        if not n.is_finite() or abs(n.adjusted()) > 2000:
            return None
        with localcontext() as ctx:
            ctx.prec, ctx.rounding = 15, rounding
            return +n
    except InvalidOperation:
        return None


def keys_for(rows, historic):
    numeric, dates = defaultdict(set), defaultdict(set)
    for key in historic:
        for rounding in (ROUND_HALF_EVEN, ROUND_DOWN):
            if (sig := signature(key, rounding)) is not None:
                numeric[sig].add(key)
        match = re.fullmatch(r"([0-9]{1,2})[-/]([0-9]{4})", key)
        if match and 1 <= int(match[1]) <= 12 and 1900 <= int(match[2]) <= 9999:
            serial = (date(int(match[2]), int(match[1]), 1) - date(1899,12,30)).days
            dates[serial].add(key)
    result = []
    for number, values, is_date in rows:
        cell = values["ARTICULO"]
        observed = cell["valor"]
        if cell["tipo"] != "n":
            candidates, evidence = {observed}, "texto-exacto"
        else:
            sig = signature(observed)
            require(sig is not None, f"Código numérico inválido, fila {number}.")
            candidates = set(numeric.get(sig, ()))
            if is_date:
                candidates.update(dates.get(sig, ()))
            evidence = "historial"
            if not candidates:
                require(not is_date, f"Fecha sin clave histórica, fila {number}.")
                evidence = "sin-historial"
                n = Decimal(observed)
                if n >= 0 and n == n.to_integral_value() and n.adjusted() < 15:
                    digits = str(int(n))
                    candidates = {digits.zfill(width) for width in range(len(digits), 2001)}
                else:
                    candidates = {observed}
        result.append([observed, evidence, candidates])
    changed = True
    while changed:
        changed = False
        right, next_key = [None] * len(result), None
        for idx in reversed(range(len(result))):
            right[idx] = next_key
            choices = result[idx][2]
            if len(choices) == 1:
                key = next(iter(choices))
                require(next_key is None or key < next_key, "Orden de anclas inválido o código repetido.")
                next_key = key
        left = None
        for idx, record in enumerate(result):
            choices = record[2]
            if len(choices) > 1:
                bounded = {k for k in choices if (left is None or left < k) and (right[idx] is None or k < right[idx])}
                require(bounded, f"Código sin candidato ordinal, fila {rows[idx][0]}.")
                if len(choices) != len(bounded):
                    record[2], changed = bounded, True
            if len(record[2]) == 1:
                left = next(iter(record[2]))
    adopted, used = [], set()
    for (number, _, _), (observed,evidence,candidates) in zip(rows,result):
        require(len(candidates) == 1, f"Código ambiguo, fila {number}.")
        inferred = next(iter(candidates))
        code = observed if evidence == "sin-historial" else inferred
        require(code not in used and len(code) <= 2000, f"Código repetido o demasiado largo, fila {number}.")
        used.add(code)
        adopted.append((code,evidence,inferred if evidence == "sin-historial" else ""))
    return adopted


def amount(raw, scale, maximum, excel=False):
    n = signature(raw) if excel else Decimal(raw)
    require(n is not None and n.is_finite() and 0 <= n <= maximum and
            n == n.quantize(Decimal(1).scaleb(-scale)), "Importe o cantidad fuera de precisión o rango.")
    return format(n, f".{scale}f")


def flag(raw):
    require(raw in ("True","False","1","0"), "Indicador booleano inválido.")
    return raw in ("True","1")


def catalog_data(out, rows, keys, masters):
    options, names = {}, {}
    for table, (field, label) in CHOICES.items():
        source = masters[table]
        lookup = {r[field]: r["DESCRIPCION"] for r in source}
        require(len(lookup) == len(source) and all(k and v.strip() for k,v in lookup.items()), "Maestro de catálogo inválido.")
        names[field] = lookup
        options[label] = sorted(set(lookup.values()))
    review = []
    maximum = Decimal("999999999999.99")
    with (out/"products.csv").open("w",encoding="utf-8",newline="") as file:
        products = writer(file)
        products.writerow(PRODUCT_COLUMNS)
        for (number, values, _), (code,evidence,hint) in zip(rows,keys_for(rows,keys)):
            row = {k:c["valor"] for k,c in values.items()}
            def quantity(field, scale, limit):
                try:
                    return amount(row[field], scale, limit, excel=values[field]["tipo"] == "n")
                except (Invalid, InvalidOperation):
                    raise Invalid(f"Precisión o rango inválido en {field}, fila {number}.") from None
            detail = [number,row["ARTICULO"],code,evidence,hint]
            review.append(dict(zip(PRODUCT_COLUMNS[:5], detail)))
            require(row["DESCRIPCION"].strip(), f"Artículo sin descripción, fila {number}.")
            require(all(row[k] in v for k,v in names.items()), f"Referencia de catálogo desconocida, fila {number}.")
            products.writerow([*detail, dump(values), row["DESCRIPCION"], quantity("COSTO",4,maximum),
                *[quantity(k,4,maximum) for k in ("PRECIO","PRECIO2","PRECIO3")],
                *[quantity(k,2,2147483647) for k in ("EXISTENCIA","MINIMO")],
                *[flag(row[k]) for k in ("NOTIFICAR_MINIMO","IMPUESTOS","ACTIVO")],
                *[names[k][row[k]] for k in ("CATEGORIA","MARCA","UBICACION")]])
    (out/"key-review.json").write_text(dump(review), encoding="utf-8")
    require(len(masters["EMPRESA"]) == 1, "Se requiere una empresa.")
    company = masters["EMPRESA"][0]
    require(flag(company["IMPUESTOS_INCLUIDOS"]) and Decimal(company["ITBIS"]) == 18, "Se requiere ITBIS 18 % incluido.")
    with (out/"settings.csv").open("w",encoding="utf-8",newline="") as file:
        writer(file).writerow([*[company[k] for k in ("NOMBRE_EMPRESA","RNC","TELEFONO","EMAIL","DIRECCION")],
                              *[dump(options[k]) for _,k in CHOICES.values()]])
    with (out/"contacts.csv").open("w",encoding="utf-8",newline="") as file:
        contacts = writer(file)
        for table, field in [("CLIENTES","CLIENTE"),("SUPLIDORES","SUPLIDOR")]:
            used = set()
            for row in masters[table]:
                key = row[field]
                require(key and key not in used and row["NOMBRE_"+field].strip(), "Contacto inválido o repetido.")
                used.add(key)
                credit = row.get("LIMITE_CREDITO","") if table == "CLIENTES" else ""
                contacts.writerow([table,key,row["NOMBRE_"+field],row["RNC"],row["TELEFONO"],row["EMAIL"],
                                  row.get("DIRECCION",""),row.get("CONTACTO",""),amount(credit,2,maximum) if credit else "",flag(row["ACTIVO"])])

def load_sql(fingerprint, sources):
    # Los únicos fragmentos variables son identificadores validados, enteros y una huella hexadecimal.
    sql = [rf"""BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $$ BEGIN
  IF current_setting('log_error_verbosity') <> 'terse' THEN PERFORM set_config('log_error_verbosity','terse',true); END IF;
  IF current_setting('log_min_error_statement') <> 'panic' THEN PERFORM set_config('log_min_error_statement','panic',true); END IF;
  IF current_setting('log_statement') <> 'none' THEN PERFORM set_config('log_statement','none',true); END IF;
END $$;
SELECT pg_advisory_xact_lock(74198232);
SELECT EXISTS(SELECT FROM pos_privado.netpos_importaciones i JOIN pos_privado.sistema s
  ON s.database_id=i.database_id WHERE i.huella='{fingerprint}') AS repetido \gset
\if :repetido
COMMIT;
\else
DO $$ BEGIN
  IF EXISTS(SELECT FROM (VALUES ('productos','precio1',4),('productos','precio2',4),('productos','precio3',4),
      ('productos','costo',4),('productos','stock',2),('productos','stock_minimo',2),
      ('venta_detalles','precio',4),('compra_detalles','costo',4),('compra_detalles','precio1',4),
      ('compra_detalles','precio2',4),('compra_detalles','precio3',4)) AS e(tabla,columna,escala)
      LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=e.tabla AND c.column_name=e.columna
      WHERE c.numeric_scale IS DISTINCT FROM e.escala) THEN
    RAISE EXCEPTION 'Esquema de precisión incompatible';
  END IF;
  IF EXISTS(SELECT FROM pos_privado.netpos_importaciones) OR EXISTS(SELECT FROM public.productos)
     OR EXISTS(SELECT FROM public.ventas) OR EXISTS(SELECT FROM public.compras)
     OR EXISTS(SELECT FROM public.movimientos_inventario) THEN
    RAISE EXCEPTION 'La carga inicial requiere una base disponible';
  END IF;
END $$;
CREATE TEMP TABLE empresa(nombre text,rnc text,tel text,correo text,direccion text,
 categorias jsonb,marcas jsonb,ubicaciones jsonb,unidades jsonb) ON COMMIT DROP;
\copy empresa FROM 'settings.csv' WITH (FORMAT csv)
INSERT INTO pos_privado.netpos_importaciones(huella,database_id,categorias,marcas,ubicaciones,unidades)
SELECT '{fingerprint}',s.database_id,
 ARRAY(SELECT jsonb_array_elements_text(e.categorias)),ARRAY(SELECT jsonb_array_elements_text(e.marcas)),
 ARRAY(SELECT jsonb_array_elements_text(e.ubicaciones)),ARRAY(SELECT jsonb_array_elements_text(e.unidades))
 FROM pos_privado.sistema s CROSS JOIN empresa e WHERE s.id=1;
UPDATE public.configuracion c SET empresa=e.nombre,rnc=e.rnc,tel=e.tel,correo=e.correo,direccion=e.direccion,
 tasa_itbis=0.18,version=c.version+1,actualizado_en=now() FROM empresa e WHERE c.id=1;
CREATE TEMP TABLE archivos(nombre text,tamano bigint,sha256 text,columnas jsonb,filas bigint,contenido text) ON COMMIT DROP;
\copy archivos FROM 'archive.csv' WITH (FORMAT csv)
INSERT INTO pos_privado.netpos_archivos(huella,nombre,tamano,sha256,columnas,filas,original_gzip)
 SELECT '{fingerprint}',nombre,tamano,sha256,columnas,filas,decode(contenido,'base64') FROM archivos;"""]
    for entry in sources:
        if "table" not in entry:
            continue
        table = entry["table"]
        definitions = ", ".join(f'"{h}" text NOT NULL' for h in entry["columns"])
        sql.append(rf"""CREATE TABLE netpos_historico."{table}" (_fila bigint PRIMARY KEY, {definitions});
\copy netpos_historico."{table}" FROM 'history-{table}.csv' WITH (FORMAT csv)
DO $$ BEGIN
  IF (SELECT count(*) FROM netpos_historico."{table}") <> {entry["rows"]} THEN
    RAISE EXCEPTION 'Conteo histórico incorrecto';
  END IF;
END $$;""")
    sql.append(r"""REVOKE ALL ON ALL TABLES IN SCHEMA netpos_historico FROM PUBLIC,pos_app;
DO $$ DECLARE rol text; BEGIN
  FOREACH rol IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=rol) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA netpos_historico FROM %I',rol);
    END IF;
  END LOOP;
END $$;
CREATE TEMP TABLE articulos(fila integer,codigo_original text,codigo text,evidencia text,sugerencia text,original jsonb,
 nombre text,costo numeric,precio1 numeric,precio2 numeric,precio3 numeric,stock numeric,stock_minimo numeric,
 notificar_minimo boolean,gravado boolean,activo boolean,categoria text,marca text,ubicacion text) ON COMMIT DROP;
\copy articulos FROM 'products.csv' WITH (FORMAT csv, HEADER MATCH)
INSERT INTO public.productos(codigo,nombre,costo,precio1,precio2,precio3,stock,stock_minimo,notificar_minimo,
 gravado,activo,categoria,marca,ubicacion) SELECT codigo,nombre,costo,precio1,precio2,precio3,stock,stock_minimo,
 notificar_minimo,gravado,activo,categoria,marca,ubicacion FROM articulos ORDER BY fila;
INSERT INTO pos_privado.netpos_catalogo(huella,fila,codigo_original,codigo,evidencia,sugerencia,original,producto_id)
 SELECT i.huella,a.fila,a.codigo_original,a.codigo,a.evidencia,a.sugerencia,a.original,p.id
 FROM articulos a JOIN public.productos p USING(codigo) CROSS JOIN pos_privado.netpos_importaciones i;
INSERT INTO public.movimientos_inventario(producto_id,tipo,cantidad,existencia_posterior,motivo)
 SELECT id,'apertura',stock,stock,'Apertura NetPOS' FROM public.productos WHERE stock<>0;
CREATE TEMP TABLE contactos(tipo text,origen text,nombre text,rnc text,tel text,correo text,direccion text,
 contacto text,limite text,activo boolean,id bigint,PRIMARY KEY(tipo,origen)) ON COMMIT DROP;
\copy contactos(tipo,origen,nombre,rnc,tel,correo,direccion,contacto,limite,activo) FROM 'contacts.csv' WITH (FORMAT csv)
UPDATE contactos SET id=CASE tipo WHEN 'CLIENTES' THEN nextval('public.clientes_id_seq')
 WHEN 'SUPLIDORES' THEN nextval('public.suplidores_id_seq') END;
INSERT INTO public.clientes(id,nombre,rnc,tel,correo,direccion,limite_credito,activo,saldo_apertura)
 SELECT id,nombre,rnc,tel,correo,direccion,NULLIF(limite,'')::numeric,activo,0 FROM contactos WHERE tipo='CLIENTES';
INSERT INTO public.suplidores(id,nombre,rnc,tel,correo,contacto,activo)
 SELECT id,nombre,rnc,tel,correo,contacto,activo FROM contactos WHERE tipo='SUPLIDORES';
INSERT INTO pos_privado.netpos_contactos(huella,tipo,origen,contacto_id)
 SELECT i.huella,c.tipo,c.origen,c.id FROM contactos c CROSS JOIN pos_privado.netpos_importaciones i;""")
    expected = {e["table"]:e["rows"] for e in sources if "table" in e}
    product_count = next(e["rows"] for e in sources if "table" not in e)
    sql.append(rf"""DO $$ BEGIN
 IF (SELECT count(*) FROM pos_privado.netpos_archivos) <> {len(sources)}
 OR (SELECT count(*) FROM pos_privado.netpos_catalogo) <> {product_count}
 OR EXISTS(SELECT FROM articulos a JOIN public.productos p USING(codigo)
    WHERE (a.costo,a.precio1,a.precio2,a.precio3,a.stock,a.stock_minimo)
       <> (p.costo,p.precio1,p.precio2,p.precio3,p.stock,p.stock_minimo))
 OR (SELECT count(*) FROM pos_privado.netpos_contactos) <> {expected['clientes']+expected['suplidores']} THEN
   RAISE EXCEPTION 'Conteo de carga incorrecto';
 END IF;
END $$;
UPDATE pos_privado.sistema SET revision=revision+1 WHERE id=1;
COMMIT;
\endif
""")
    return "\n".join(sql)


def prepare(source, destination):
    require(source.is_absolute() and destination.is_absolute(), "Se requieren rutas absolutas.")
    source, destination = source.resolve(), destination.resolve()
    require(source.is_dir() and destination.parent.is_dir(), "Carpeta de entrada o destino inválida.")
    require(not destination.exists() and not destination.is_relative_to(source)
            and not destination.is_relative_to(REPO), "El paquete requiere una carpeta privada nueva fuera del proyecto y del origen.")
    require(not any(part.casefold() in ("public","wwwroot","htdocs") for part in destination.parts)
            and not any((parent/".git").exists() for parent in destination.parents),
            "El destino pertenece a una raíz pública o un repositorio.")
    files = sorted(source.iterdir(), key=lambda p:p.name)
    require(all(p.is_file() and not p.is_symlink() and p.suffix.lower() in (".csv",".xlsx") for p in files),
            "Carpeta de origen con archivos no admitidos.")
    books = [p for p in files if p.suffix.lower() == ".xlsx"]
    csvs = [p for p in files if p.suffix.lower() == ".csv"]
    tables = {p.stem.upper() for p in csvs}
    require(len(books) == 1 and len(tables) == len(csvs) and REQUIRED.keys() <= tables
            and all(IDENT.fullmatch(p.stem) for p in csvs), "Faltan maestros, hay duplicados o nombres no admitidos.")
    first = {p.name:sha(p) for p in files}
    fingerprint = hashlib.sha256(dump([[p.name,first[p.name]] for p in files]).encode("utf-8")).hexdigest()
    with TemporaryDirectory(dir=destination.parent, prefix=".netpos-") as temporary:
        out = Path(temporary)/"paquete"
        out.mkdir(mode=0o700)
        keys, masters, details = set(), {}, {}
        for path in csvs:
            table = path.stem.lower()
            columns,count,retained = read_history(path, out/f"history-{table}.csv",keys)
            masters[table.upper()] = retained
            details[path.name] = {"table":table,"columns":columns,"rows":count}
        header,rows = xlsx(books[0])
        details[books[0].name] = {"columns":header,"rows":len(rows)}
        catalog_data(out,rows,keys,masters)
        sources = []
        with (out/"archive.csv").open("w",encoding="utf-8",newline="") as file:
            archive = writer(file)
            for path in files:
                original = path.read_bytes()
                digest = hashlib.sha256(original).hexdigest()
                require(digest == first[path.name], "Un archivo cambió durante la preparación.")
                entry = {"name":path.name,"bytes":len(original),"sha256":digest,**details[path.name]}
                sources.append(entry)
                archive.writerow([path.name,len(original),digest,dump(entry["columns"]),entry["rows"],
                                  base64.b64encode(gzip.compress(original, compresslevel=6,mtime=0)).decode("ascii")])
        (out/"load.sql").write_text(load_sql(fingerprint,sources),encoding="utf-8",newline="\n")
        manifest = {"format":1,"fingerprint":fingerprint,"sources":sources,"artifacts":{p.name:sha(p) for p in sorted(out.iterdir())}}
        (out/"manifest.json").write_text(dump(manifest),encoding="utf-8")
        require(first == {p.name:sha(p) for p in sorted(source.iterdir())}, "El origen cambió al preparar el paquete.")
        out.rename(destination)
    print(f"Paquete preparado. Archivos {len(sources)}, artículos {len(rows)}, filas CSV {sum(e['rows'] for e in sources if 'table' in e)}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        os.umask(0o077)
        csv.field_size_limit(16*1024*1024)
        prepare(args.source,args.output)
    except Invalid as exc:
        sys.exit(str(exc))
    except (OSError, ValueError, InvalidOperation, ET.ParseError, BadZipFile, csv.Error, KeyError, AttributeError, IndexError):
        sys.exit("No se pudo validar o escribir el paquete NetPOS.")
