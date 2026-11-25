-- Rellena public.productos.referencia desde el archivo original de NetPOS
-- (pos_privado.netpos_catalogo) para los artículos cuya referencia sigue vacía.
-- Idempotente: conserva intacta cualquier referencia editada manualmente.
WITH actualizados AS (
  UPDATE public.productos p
  SET referencia = left(btrim(nc.original->'REFERENCIA'->>'valor'), 2000),
      actualizado_en = now()
  FROM pos_privado.netpos_catalogo nc
  JOIN pos_privado.netpos_importaciones ni ON ni.huella = nc.huella
  JOIN pos_privado.sistema s ON s.id = 1 AND s.database_id = ni.database_id
  WHERE nc.producto_id = p.id
    AND btrim(p.referencia) = ''
    AND NULLIF(btrim(COALESCE(nc.original->'REFERENCIA'->>'valor', '')), '') IS NOT NULL
  RETURNING p.id
)
UPDATE pos_privado.sistema
SET revision = revision + 1
WHERE id = 1
  AND EXISTS (SELECT 1 FROM actualizados);
