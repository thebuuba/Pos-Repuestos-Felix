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
  if (method === 'GET' && /^\/api\/productos\/[1-9]\d*\/movimientos$/.test(path)) return true;
  if (method === 'PUT' && path === '/api/account') return true;
  if (method === 'POST' && ['/api/ventas', '/api/caja/abrir', '/api/caja/cerrar',
    '/api/caja/movimiento', '/api/clientes', '/api/cuentas/cobros',
    '/api/taller', '/api/recordatorios',
    '/api/sync/operations', '/api/sync/retire',
    '/api/desktop/sync', '/api/desktop/reconcile'].includes(path)) return true;
  if (method === 'POST' && /^\/api\/taller\/[1-9]\d*\/(despachar|devolver|cancelar|facturar)$/.test(path)) return true;
  if (method === 'PUT' && /^\/api\/clientes\/[1-9]\d*$/.test(path)) return true;
  if ((method === 'PUT' || method === 'DELETE') && /^\/api\/recordatorios\/[1-9]\d*$/.test(path)) return true;
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
        ...(snapshot.changes.suplidoresUpsert
          ? { suplidoresUpsert: snapshot.changes.suplidoresUpsert.map(s => ({ ...s, deuda: 0 })) }
          : {}),
        ...(snapshot.changes.comprasUpsert ? { comprasUpsert: [] } : {}),
        ...(snapshot.changes.abonosUpsert
          ? { abonosUpsert: snapshot.changes.abonosUpsert.filter(a => a.tipo !== 'pago') }
          : {}),
        ...(snapshot.changes.movimientosUpsert
          ? { movimientosUpsert: snapshot.changes.movimientosUpsert.filter(m => m.tipo !== 'compra' && m.tipo !== 'anulacion_compra') }
          : {}),
      },
    };
  }
  if (!snapshot.state) return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      productos: snapshot.state.productos.map(p => Array.isArray(p)
        ? Object.assign([...p], { 11: '0.0000' })
        : ({ ...p, costo: 0, costoExacto: '0.0000' })),
      suplidores: (snapshot.state.suplidores || []).map(s => ({ ...s, deuda: 0 })),
      compras: [],
      abonos: (snapshot.state.abonos || []).filter(a => a.tipo !== 'pago'),
      movimientos: (snapshot.state.movimientos || []).filter(m => m.tipo !== 'compra' && m.tipo !== 'anulacion_compra'),
    },
  };
}

export function redactBootstrapForRole(download, role) {
  if (isOwner(role) || !download) return download;
  const snapshot = redactSnapshotForRole(download.snapshot, role);
  if (!download.backup?.tables) return { ...download, snapshot };
  const src = download.backup.tables;
  // Conservar únicamente pagos en efectivo ligados a turnos de caja para preservar la cuadratura de caja en restore().
  const keptPayments = (src.abonos_cuentas || [])
    .filter(a => a.tipo === 'cobro' || (a.tipo === 'pago' && a.metodo_pago === 'efectivo' && a.caja_id !== null))
    .map(a => a.tipo === 'pago' ? { ...a, referencia: '', nota: '' } : a);
  const keptPurchaseIds = new Set(keptPayments.filter(a => a.compra_id !== null).map(a => String(a.compra_id)));
  const keptCompras = (src.compras || [])
    .filter(c => keptPurchaseIds.has(String(c.id)))
    .map(c => ({ ...c, suplidor_nombre: 'Restringido', numero: `Restringido-${c.id}` }));
  const keptDetails = (src.compra_detalles || [])
    .filter(d => keptPurchaseIds.has(String(d.compra_id)))
    .map(d => ({ ...d, nombre: 'Restringido' }));
  const keptDetailIds = new Set(keptDetails.map(d => String(d.id)));
  const movimientos = (src.movimientos_inventario || []).map(m => {
    if ((m.tipo === 'compra' && !keptDetailIds.has(String(m.compra_detalle_id))) || m.tipo === 'anulacion_compra') {
      return { ...m, tipo: 'ajuste', compra_detalle_id: null, motivo: '' };
    }
    return m;
  });
  return {
    ...download,
    snapshot,
    backup: {
      ...download.backup,
      tables: {
        ...src,
        productos: (src.productos || []).map(p => ({ ...p, costo: '0.0000' })),
        compras: keptCompras,
        compra_detalles: keptDetails,
        abonos_cuentas: keptPayments,
        movimientos_inventario: movimientos,
        secuencias_ncf: [],
      },
    },
  };
}
