-- Amplía factor_costo de fórmulas de precios de 3 a 6 decimales (ej. 1.1092, 1.03132, 0.847458).
ALTER TABLE public.formulas_precios
  DROP CONSTRAINT IF EXISTS formulas_precios_factor_costo_check,
  ALTER COLUMN factor_costo TYPE numeric(12,6),
  ADD CONSTRAINT formulas_precios_factor_costo_check CHECK (factor_costo BETWEEN 0.000001 AND 999999.999999);
