-- Archivo administrativo. Los identificadores operativos pertenecen a database_id,
-- incluso si una restauración posterior reutiliza los mismos números de fila.
CREATE SCHEMA netpos_historico;
REVOKE ALL ON SCHEMA netpos_historico FROM PUBLIC,pos_app;
CREATE TABLE pos_privado.netpos_importaciones (
  huella text PRIMARY KEY CHECK(huella ~ '^[0-9a-f]{64}$'), database_id uuid NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(), categorias text[] NOT NULL,
  marcas text[] NOT NULL, ubicaciones text[] NOT NULL, unidades text[] NOT NULL
);
CREATE TABLE pos_privado.netpos_archivos (
  huella text NOT NULL REFERENCES pos_privado.netpos_importaciones(huella),
  nombre text NOT NULL, tamano bigint NOT NULL CHECK(tamano>=0), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  columnas jsonb NOT NULL CHECK(jsonb_typeof(columnas)='array'), filas bigint NOT NULL CHECK(filas>=0),
  original_gzip bytea NOT NULL, PRIMARY KEY(huella,nombre)
);
CREATE TABLE pos_privado.netpos_catalogo (
  huella text NOT NULL REFERENCES pos_privado.netpos_importaciones(huella), fila integer NOT NULL CHECK(fila>0),
  codigo_original text NOT NULL, codigo text NOT NULL, evidencia text NOT NULL, sugerencia text NOT NULL,
  original jsonb NOT NULL CHECK(jsonb_typeof(original)='object'), producto_id bigint NOT NULL,
  PRIMARY KEY(huella,fila), UNIQUE(huella,codigo), UNIQUE(huella,producto_id)
);
CREATE TABLE pos_privado.netpos_contactos (
  huella text NOT NULL REFERENCES pos_privado.netpos_importaciones(huella), tipo text NOT NULL CHECK(tipo IN ('CLIENTES','SUPLIDORES')),
  origen text NOT NULL, contacto_id bigint NOT NULL, PRIMARY KEY(huella,tipo,origen), UNIQUE(huella,tipo,contacto_id)
);

CREATE FUNCTION pos_privado.netpos_opciones() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('categorias',COALESCE(i.categorias,'{}'::text[]),'marcas',COALESCE(i.marcas,'{}'::text[]),
    'ubicaciones',COALESCE(i.ubicaciones,'{}'::text[]),'unidades',COALESCE(i.unidades,'{}'::text[]))
  FROM pos_privado.sistema s LEFT JOIN pos_privado.netpos_importaciones i ON i.database_id=s.database_id WHERE s.id=1
$$;
REVOKE ALL ON pos_privado.netpos_importaciones,pos_privado.netpos_archivos,pos_privado.netpos_catalogo,pos_privado.netpos_contactos FROM PUBLIC,pos_app;
REVOKE ALL ON FUNCTION pos_privado.netpos_opciones() FROM PUBLIC;
DO $$ DECLARE rol text; BEGIN
  FOREACH rol IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=rol) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA netpos_historico FROM %I',rol);
      EXECUTE format('REVOKE ALL ON pos_privado.netpos_importaciones,pos_privado.netpos_archivos,pos_privado.netpos_catalogo,pos_privado.netpos_contactos FROM %I',rol);
      EXECUTE format('REVOKE ALL ON FUNCTION pos_privado.netpos_opciones() FROM %I',rol);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION pos_privado.netpos_opciones() TO pos_app;
