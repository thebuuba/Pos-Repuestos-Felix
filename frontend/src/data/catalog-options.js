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
  return [...new Set([
    ...(state?.catalogo?.categorias ?? []),
    ...(state?.productos.map(product => product.categoria) ?? []),
  ].filter(Boolean))];
}
