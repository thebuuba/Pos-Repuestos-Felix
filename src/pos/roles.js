// Roles del negocio: "dueno" (acceso completo) y "cajero" (operación de mostrador).
// Las cuentas creadas antes de asignar roles conservan "dueno" para no bloquear acceso existente.
export const ROLES = Object.freeze({ DUENO: 'dueno', CAJERO: 'cajero' });
// Tope máximo de descuento permitido a un cajero sin autorización del dueño (10.00 %).
export const MAX_CASHIER_DISCOUNT_BPS = 1000n;

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

const redactItemsCost = items => Array.isArray(items)
  ? items.map(item => ({ ...item, costoUnitario: null, costoUnitarioExacto: null }))
  : items;

const redactDocWithItems = list => (list || []).map(doc => ({ ...doc, items: redactItemsCost(doc.items) }));

const redactSupplier = s => ({ ...s, deuda: 0, diasCredito: null, formulaId: null });

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
          ? { suplidoresUpsert: snapshot.changes.suplidoresUpsert.map(redactSupplier) }
          : {}),
        ...(snapshot.changes.formulasUpsert ? { formulasUpsert: [] } : {}),
        ...(snapshot.changes.facturasUpsert
          ? { facturasUpsert: redactDocWithItems(snapshot.changes.facturasUpsert) }
          : {}),
        ...(snapshot.changes.cuentasTallerUpsert
          ? { cuentasTallerUpsert: redactDocWithItems(snapshot.changes.cuentasTallerUpsert) }
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
      formulas: [],
      suplidores: (snapshot.state.suplidores || []).map(redactSupplier),
      facturas: redactDocWithItems(snapshot.state.facturas),
      cuentasTaller: redactDocWithItems(snapshot.state.cuentasTaller),
      compras: [],
      abonos: (snapshot.state.abonos || []).filter(a => a.tipo !== 'pago'),
      movimientos: (snapshot.state.movimientos || []).filter(m => m.tipo !== 'compra' && m.tipo !== 'anulacion_compra'),
    },
  };
}

export function redactBackupTablesForRole(backup, role) {
  if (isOwner(role) || !backup?.tables) return backup;
  const src = backup.tables;
  // Conservar únicamente pagos en efectivo ligados a turnos de caja para preservar la cuadratura de caja en restore().
  const keptPayments = (src.abonos_cuentas || [])
    .filter(a => a.tipo === 'cobro' || (a.tipo === 'pago' && a.metodo_pago === 'efectivo' && a.caja_id !== null))
    .map(a => a.tipo === 'pago' ? { ...a, referencia: '', nota: '' } : a);
  const keptPurchaseIds = new Set(keptPayments.filter(a => a.compra_id !== null).map(a => String(a.compra_id)));
  const keptCompras = (src.compras || [])
    .filter(c => keptPurchaseIds.has(String(c.id)))
    .map(c => ({ ...c, suplidor_nombre: 'Restringido', numero: `Restringido-${c.id}` }));
  const fallbackProductId = src.productos?.[0]?.id ?? null;
  // Reemplazar detalles comerciales reales por una sola línea sintética por compra retenida para no filtrar códigos ni costos.
  const keptDetails = [];
  if (keptCompras.length && fallbackProductId !== null) {
    const firstDetailIdByPurchase = new Map();
    for (const d of src.compra_detalles || []) {
      const key = String(d.compra_id);
      if (keptPurchaseIds.has(key) && !firstDetailIdByPurchase.has(key)) firstDetailIdByPurchase.set(key, d.id);
    }
    for (const c of keptCompras) {
      const detailId = firstDetailIdByPurchase.get(String(c.id)) ?? c.id;
      const totalStr = String(c.total);
      const costStr = totalStr.includes('.') ? totalStr.replace(/\.(\d+)$/, (_, dec) => '.' + dec.padEnd(4, '0').slice(0, 4)) : `${totalStr}.0000`;
      keptDetails.push({
        id: detailId,
        compra_id: c.id,
        producto_id: fallbackProductId,
        codigo: 'RESTRINGIDO',
        nombre: 'Restringido',
        cantidad: '1.00',
        costo: costStr,
        precio1: '0.0000',
        precio2: '0.0000',
        precio3: '0.0000',
        total: totalStr,
      });
    }
  }
  const movimientos = (src.movimientos_inventario || []).map(m => {
    if (m.tipo === 'compra' || m.tipo === 'anulacion_compra') {
      return { ...m, tipo: 'ajuste', compra_detalle_id: null, motivo: '' };
    }
    return m;
  });
  return {
    ...backup,
    tables: {
      ...src,
      formulas_precios: [],
      suplidores: (src.suplidores || []).map(s => ({ ...s, dias_credito: null, formula_id: null })),
      productos: (src.productos || []).map(p => ({ ...p, costo: '0.0000' })),
      venta_detalles: (src.venta_detalles || []).map(d => (
        Object.hasOwn(d, 'costo_unitario') ? { ...d, costo_unitario: null } : d
      )),
      cuentas_taller_items: (src.cuentas_taller_items || []).map(i => (
        Object.hasOwn(i, 'costo_unitario') ? { ...i, costo_unitario: null } : i
      )),
      compras: keptCompras,
      compra_detalles: keptDetails,
      abonos_cuentas: keptPayments,
      movimientos_inventario: movimientos,
      secuencias_ncf: [],
    },
  };
}

export function redactBootstrapForRole(download, role) {
  if (isOwner(role) || !download) return download;
  const snapshot = redactSnapshotForRole(download.snapshot, role);
  if (!download.backup?.tables) return { ...download, snapshot };
  return {
    ...download,
    snapshot,
    backup: redactBackupTablesForRole(download.backup, role),
  };
}
