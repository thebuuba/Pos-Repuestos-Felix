-- Conserva el costo unitario del catálogo al momento de cada venta y despacho de taller.
-- Las ventas y despachos ya existentes se inicializan con el costo actual del producto.
ALTER TABLE public.venta_detalles
  ADD COLUMN costo_unitario numeric(16,4) CHECK(costo_unitario IS NULL OR costo_unitario BETWEEN 0 AND 999999999999.9999);

ALTER TABLE public.cuentas_taller_items
  ADD COLUMN costo_unitario numeric(16,4) CHECK(costo_unitario IS NULL OR costo_unitario BETWEEN 0 AND 999999999999.9999);

UPDATE public.venta_detalles vd
   SET costo_unitario = p.costo
  FROM public.productos p
 WHERE p.id = vd.producto_id
   AND vd.costo_unitario IS NULL;

UPDATE public.cuentas_taller_items cti
   SET costo_unitario = p.costo
  FROM public.productos p
 WHERE p.id = cti.producto_id
   AND cti.costo_unitario IS NULL;
