// Roles del negocio: "dueno" (acceso completo) y "cajero" (operación de mostrador).
// Las cuentas creadas antes de asignar roles conservan "dueno" para no bloquear acceso existente.
export const ROLES = Object.freeze({ DUENO: 'dueno', CAJERO: 'cajero' });

export function normalizeRole(value) {
  return value === ROLES.CAJERO ? ROLES.CAJERO : ROLES.DUENO;
}

export function userRole(user) {
  return normalizeRole(user?.app_metadata?.rol);
}

export function isOwner(role) {
  return normalizeRole(role) === ROLES.DUENO;
}

export function allowedOperation(role, method, path) {
  if (isOwner(role)) return true;
  if (method === 'GET' && ['/api/state', '/api/account', '/api/sync/bootstrap',
    '/api/desktop/status', '/api/desktop/pending', '/api/desktop/reconciliation',
    '/api/desktop/archive', '/api/desktop/export'].includes(path)) return true;
  if (method === 'PUT' && path === '/api/account') return true;
  if (method === 'POST' && ['/api/ventas', '/api/caja/abrir', '/api/caja/cerrar',
    '/api/caja/movimiento', '/api/clientes', '/api/cuentas/cobros',
    '/api/sync/operations', '/api/sync/retire',
    '/api/desktop/sync', '/api/desktop/reconcile'].includes(path)) return true;
  if (method === 'PUT' && /^\/api\/clientes\/[1-9]\d*$/.test(path)) return true;
  return false;
}

export function redactSnapshotForRole(snapshot, role) {
  if (isOwner(role) || !snapshot) return snapshot;
  if (snapshot.delta && snapshot.changes) {
    return {
      ...snapshot,
      changes: {
        ...snapshot.changes,
        ...(snapshot.changes.productosUpsert
          ? { productosUpsert: snapshot.changes.productosUpsert.map(p => ({ ...p, costo: 0, costoExacto: '0.0000' })) }
          : {}),
        ...(snapshot.changes.comprasUpsert ? { comprasUpsert: [] } : {}),
      },
    };
  }
  if (!snapshot.state) return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      productos: snapshot.state.productos.map(p => ({ ...p, costo: 0, costoExacto: '0.0000' })),
      compras: [],
    },
  };
}
