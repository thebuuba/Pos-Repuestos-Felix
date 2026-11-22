-- Los precios unitarios conservan la precisión del catálogo. El total documental sigue en centavos.
ALTER TABLE public.productos
  ALTER COLUMN precio1 TYPE numeric(16,4),
  ALTER COLUMN precio2 TYPE numeric(16,4),
  ALTER COLUMN precio3 TYPE numeric(16,4);
ALTER TABLE public.venta_detalles
  ALTER COLUMN precio TYPE numeric(16,4);
ALTER TABLE public.compra_detalles
  ALTER COLUMN precio1 TYPE numeric(16,4),
  ALTER COLUMN precio2 TYPE numeric(16,4),
  ALTER COLUMN precio3 TYPE numeric(16,4);
