-- Fuera de public: Supabase no expone estos datos a través de su Data API.
CREATE SCHEMA IF NOT EXISTS pos_privado;
REVOKE ALL ON SCHEMA pos_privado FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pos_privado.estado (
    id smallint PRIMARY KEY CHECK (id = 1),
    datos jsonb NOT NULL CHECK (jsonb_typeof(datos) = 'object'),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    actualizado_en timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE pos_privado.estado FROM PUBLIC;
