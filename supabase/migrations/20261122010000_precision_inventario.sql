-- Conservar existencias fraccionarias, costo de cuatro decimales y códigos exactos.
ALTER TABLE public.productos
  ALTER COLUMN stock TYPE numeric(12,2),
  ALTER COLUMN stock_minimo TYPE numeric(12,2),
  ALTER COLUMN costo TYPE numeric(16,4),
  ADD COLUMN notificar_minimo boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT productos_stock_limite CHECK(stock <= 2147483647),
  ADD CONSTRAINT productos_stock_minimo_limite CHECK(stock_minimo <= 2147483647);

DROP INDEX public.productos_codigo_unico;
CREATE UNIQUE INDEX productos_codigo_unico ON public.productos(codigo);

ALTER TABLE public.venta_detalles
  DROP CONSTRAINT venta_detalles_check,
  ALTER COLUMN cantidad TYPE numeric(12,2),
  ADD CONSTRAINT venta_detalles_cantidad_limite CHECK(cantidad <= 2147483647),
  ADD CONSTRAINT venta_detalles_importes CHECK(base + itbis = total AND total = round(precio * cantidad, 2));

ALTER TABLE public.compra_detalles
  DROP CONSTRAINT compra_detalles_check,
  ALTER COLUMN cantidad TYPE numeric(12,2),
  ALTER COLUMN costo TYPE numeric(16,4),
  ADD CONSTRAINT compra_detalles_cantidad_limite CHECK(cantidad <= 2147483647),
  ADD CONSTRAINT compra_detalles_importe CHECK(total = round(costo * cantidad, 2));

ALTER TABLE public.movimientos_inventario
  ALTER COLUMN cantidad TYPE numeric(12,2),
  ALTER COLUMN existencia_posterior TYPE numeric(12,2),
  ADD CONSTRAINT movimientos_inventario_cantidad_limite CHECK(cantidad BETWEEN -2147483647 AND 2147483647),
  ADD CONSTRAINT movimientos_inventario_existencia_limite CHECK(existencia_posterior <= 2147483647);
