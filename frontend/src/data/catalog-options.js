// Categorías de la referencia de Polymet usada en las pruebas visuales.
export const CATEGORIES = [
  "Motor",
  "Frenos",
  "Transmisión",
  "Eléctrico",
  "Lubricantes",
  "Llantas",
  "Accesorios",
];

export function catalogCategories(state) {
  const used = new Set();
  for (const product of state?.productos ?? []) {
    const clean = typeof product.categoria === 'string' ? product.categoria.trim() : '';
    if (clean) used.add(clean);
  }
  return [...used].sort((a, b) => a.localeCompare(b, 'es'));
}
