-- Anulación de compras: conserva auditoría, libera el número de factura del suplidor
-- para permitir re-subirla corregida y registra la reversión en movimientos_inventario.

ALTER TABLE public.compras
  ADD COLUMN estado text NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','anulada')),
  ADD COLUMN anulada_en timestamptz,
  ADD COLUMN anulada_por text CHECK(anulada_por IS NULL OR length(btrim(anulada_por)) BETWEEN 1 AND 2000),
  ADD COLUMN motivo_anulacion text CHECK(motivo_anulacion IS NULL OR length(btrim(motivo_anulacion)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT compras_anulacion_check CHECK (
    (estado = 'activa' AND anulada_en IS NULL AND anulada_por IS NULL AND motivo_anulacion IS NULL)
    OR (estado = 'anulada' AND anulada_en IS NOT NULL AND anulada_por IS NOT NULL AND motivo_anulacion IS NOT NULL)
  );

DROP INDEX IF EXISTS public.compras_factura_unica;
CREATE UNIQUE INDEX compras_factura_unica
  ON public.compras(suplidor_id, lower(numero))
  WHERE estado = 'activa';

DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.movimientos_inventario'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%tipo%' LOOP
    EXECUTE format('ALTER TABLE public.movimientos_inventario DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.movimientos_inventario
  ADD CONSTRAINT movimientos_inventario_tipo_check CHECK(tipo IN ('apertura','venta','compra','ajuste','anulacion','anulacion_compra','despacho','devolucion_despacho')),
  ADD CONSTRAINT movimientos_inventario_origen_check CHECK(
    (tipo='venta' AND venta_detalle_id IS NOT NULL AND compra_detalle_id IS NULL AND cantidad<0)
    OR (tipo='compra' AND compra_detalle_id IS NOT NULL AND venta_detalle_id IS NULL AND cantidad>0)
    OR (tipo='anulacion' AND venta_detalle_id IS NULL AND compra_detalle_id IS NULL AND cantidad>0)
    OR (tipo='anulacion_compra' AND venta_detalle_id IS NULL AND compra_detalle_id IS NULL AND cantidad<0)
    OR (tipo='despacho' AND venta_detalle_id IS NULL AND compra_detalle_id IS NULL AND cantidad<0)
    OR (tipo='devolucion_despacho' AND venta_detalle_id IS NULL AND compra_detalle_id IS NULL AND cantidad>0)
    OR (tipo IN ('apertura','ajuste') AND venta_detalle_id IS NULL AND compra_detalle_id IS NULL)
  );
