-- Estructura compatible con la API existente y los respaldos JSON del POS.
CREATE SCHEMA IF NOT EXISTS pos_privado;
REVOKE ALL ON SCHEMA pos_privado FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pos_privado.estado (
    id smallint PRIMARY KEY CHECK (id = 1),
    datos jsonb NOT NULL CHECK (jsonb_typeof(datos) = 'object'),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    actualizado_en timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE pos_privado.estado FROM PUBLIC;
ALTER TABLE pos_privado.estado ENABLE ROW LEVEL SECURITY;

-- Base nueva: sin inventario ni operaciones de demostración.
-- No reemplazar datos si la aplicación ya hubiera inicializado la base.
INSERT INTO pos_privado.estado (id, datos)
VALUES (1, '{
    "empresa": "REPUESTOS FELIX",
    "itbisRate": 0.18,
    "productos": [],
    "clientes": [{"nombre": "Cliente Contado", "rnc": "", "tel": "", "deuda": 0}],
    "suplidores": [],
    "facturas": [],
    "compras": []
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
