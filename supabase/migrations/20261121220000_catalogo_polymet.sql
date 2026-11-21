-- Persist the fields present in the approved Polymet inventory form.
-- Historical products retain their previous tax behavior and unknown metadata.
ALTER TABLE public.productos
  ADD COLUMN marca text NOT NULL DEFAULT '' CHECK(length(marca)<=2000),
  ADD COLUMN categoria text NOT NULL DEFAULT '' CHECK(length(categoria)<=2000),
  ADD COLUMN ubicacion text NOT NULL DEFAULT '' CHECK(length(ubicacion)<=2000),
  ADD COLUMN stock_minimo integer NOT NULL DEFAULT 0 CHECK(stock_minimo>=0),
  ADD COLUMN gravado boolean NOT NULL DEFAULT true;
