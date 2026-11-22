export const moduleNames = {
  '/': 'Panel', '/index.html': 'Panel', '/ventas': 'Ventas', '/inventario': 'Inventario', '/compras': 'Compras',
  '/caja': 'Caja', '/clientes': 'Clientes', '/suplidores': 'Suplidores', '/reportes': 'Reportes',
  '/cuentas-por-cobrar': 'Cuentas por cobrar', '/cuentas-por-pagar': 'Cuentas por pagar',
  '/configuracion': 'Configuración', '/ayuda': 'Ayuda',
};

export function loadingLabel(pathname, phase = 'data') {
  const name = moduleNames[pathname] || 'Félix POS';
  if (phase === 'module') return `Abriendo ${name}…`;
  return pathname === '/ventas' ? 'Cargando productos para la venta…' : `Cargando datos de ${name}…`;
}
