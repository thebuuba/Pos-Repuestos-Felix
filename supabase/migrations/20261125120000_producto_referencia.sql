-- Código de referencia del fabricante / compañía (NetPOS: Referencia).
-- No lleva restricción de unicidad porque piezas de distintas marcas o suplidores
-- pueden compartir el mismo número de referencia OEM.
ALTER TABLE public.productos
  ADD COLUMN referencia text NOT NULL DEFAULT '' CHECK(length(referencia) <= 2000);
