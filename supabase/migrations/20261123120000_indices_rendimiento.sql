-- Índices de rendimiento para búsquedas insensibles a mayúsculas, saldos a crédito,
-- referencias de fórmulas en suplidores y cursor de sincronización de escritorio.
CREATE INDEX IF NOT EXISTS productos_codigo_lower_idx
  ON public.productos (lower(codigo));

CREATE INDEX IF NOT EXISTS ventas_credito_activas_cliente_idx
  ON public.ventas (cliente_id) INCLUDE (total)
  WHERE condicion = 'Credito' AND estado = 'activa';

CREATE INDEX IF NOT EXISTS compras_credito_suplidor_idx
  ON public.compras (suplidor_id) INCLUDE (total)
  WHERE condicion = 'Credito';

CREATE INDEX IF NOT EXISTS suplidores_formula_idx
  ON public.suplidores (formula_id)
  WHERE formula_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS solicitudes_sync_cursor_idx
  ON pos_privado.solicitudes (
    (resultado->'metadata'->>'deviceId'),
    (resultado->'metadata'->>'actorId'),
    (resultado->>'databaseId'),
    ((resultado->'metadata'->>'sequence')::bigint) DESC
  )
  WHERE resultado ? 'metadata';
