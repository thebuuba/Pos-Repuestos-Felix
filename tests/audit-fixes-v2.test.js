import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap } from '../src/pos/sync-operations.js';
import { redactBootstrapForRole } from '../src/pos/roles.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { desktopServer } from '../src/desktop/server.js';
import { productForBarcode } from '../frontend/src/data/barcode-scanner.js';
import { receiptFromConfirmation } from '../frontend/src/data/operational-sales.js';

test('auditoría v2: validateCashRestore con anulaciones, redacción cajero sin colisión, RNC B01, fórmulas, índices SQL y Desktop', { timeout: 90000 }, async t => {
  const db = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  const tempDirs = [];
  let engineCajero, engine2, srv;
  t.after(async () => {
    if (srv) {
      srv.closeAllConnections();
      if (srv.listening) await new Promise(resolve => srv.close(resolve));
    }
    await engine2?.pool?.end().catch(() => {});
    engine2?.ledger?.close();
    await engineCajero?.pool?.end().catch(() => {});
    engineCajero?.ledger?.close();
    await pool.end();
    await db.stop();
    for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  });

  await migrateDatabase(pool);
  const actor = { id: 'owner-1', name: 'dueno', role: 'dueno' };
  const write = (method, path, body, context = {}) =>
    writeOperation(pool, method, path, body, randomUUID(), 'Prueba', actor, context);

  // 0. Verificar los 5 índices nuevos de la migración 20261123120000_indices_rendimiento.sql
  const idxRows = (await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE indexname = ANY($1::text[])
  `, [[
    'productos_codigo_lower_idx',
    'ventas_credito_activas_cliente_idx',
    'compras_credito_suplidor_idx',
    'suplidores_formula_idx',
    'solicitudes_sync_cursor_idx',
  ]])).rows.map(r => r.indexname).sort();
  assert.equal(idxRows.length, 5, `Deben existir los 5 índices de rendimiento, encontrados: ${idxRows.join(', ')}`);

  let snap = await readSnapshot(pool, 'Prueba');
  const dbId = snap.databaseId;

  // Crear producto, fórmula, suplidor, cliente con RNC y cliente sin RNC
  const formula = await write('POST', '/api/formulas', {
    databaseId: dbId, nombre: 'Formula Test', factorCosto: 1.18, recargo1: 35, recargo2: 25, recargo3: 15,
  });
  const supplier = await write('POST', '/api/suplidores', {
    databaseId: dbId, nombre: 'Suplidor Multi', rnc: '130111222', formulaId: formula.result.id,
  });
  const prod = await write('POST', '/api/productos', {
    databaseId: dbId, codigo: 'AUD-V2', nombre: 'Repuesto Auditoría',
    costo: '450.0000', precio1: '1000.0000', precio2: '900.0000', precio3: '800.0000', stock: '50',
  });
  const custWithRnc = await write('POST', '/api/clientes', {
    databaseId: dbId, nombre: 'Cliente Fiscal', rnc: '131555666', limiteCredito: '50000',
  });
  const custNoRnc = await write('POST', '/api/clientes', {
    databaseId: dbId, nombre: 'Cliente Sin RNC', rnc: '', limiteCredito: '10000',
  });
  // Verificar que una fórmula sin suplidores sí se puede eliminar tras desvincularla
  const snapBeforeDel = await readSnapshot(pool, 'Prueba');
  const supMainRow = snapBeforeDel.state.suplidores.find(s => s.id === supplier.result.id);
  await write('PUT', `/api/suplidores/${supMainRow.id}`, { databaseId: dbId, version: supMainRow.version, nombre: supMainRow.nombre, formulaId: null });
  const snapFormula = await readSnapshot(pool, 'Prueba');
  const fRow = snapFormula.state.formulas.find(f => f.id === formula.result.id);
  const delFormula = await write('DELETE', `/api/formulas/${fRow.id}`, { databaseId: dbId, version: fRow.version });
  assert.equal(delFormula.result.id, fRow.id);

  // Abrir turno de caja con fondo RD$ 0.00
  const turn1 = await write('POST', '/api/caja/abrir', { databaseId: dbId, monto: '0' });
  const caja1 = turn1.result.id;

  // 2. Bug #8: backend debe rechazar B01/B14 para cliente sin RNC
  snap = await readSnapshot(pool, 'Prueba');
  const prodRow = () => snap.state.productos.find(p => p.id === prod.result.id);
  const contado = snap.state.clientes.find(c => c.esContado);
  await assert.rejects(
    write('POST', '/api/ventas', {
      databaseId: dbId, cajaId: caja1, clienteId: custNoRnc.result.id,
      versionConfiguracion: snap.state.configuracionVersion,
      condicion: 'Contado', metodoPago: 'efectivo', tipoComprobante: 'B01',
      items: [{ productoId: prod.result.id, versionProducto: prodRow().version, nivelPrecio: 'precio1', cantidad: '1' }],
    }),
    err => err.status === 400 && /RNC/.test(err.message),
  );

  // 3. Bug #2: venta efectivo 1000 -> salida 500 -> venta efectivo 1000 -> anular 1ra venta efectivo (saldo queda +500)
  const cashSale1 = await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: caja1, clienteId: contado.id,
    versionConfiguracion: snap.state.configuracionVersion,
    condicion: 'Contado', metodoPago: 'efectivo', tipoComprobante: 'B02',
    items: [{ productoId: prod.result.id, versionProducto: prodRow().version, nivelPrecio: 'precio1', cantidad: '1' }],
  });
  // Verificar receiptFromConfirmation incluye grossTotal con descuento
  snap = await readSnapshot(pool, 'Prueba');
  const saleWithDisc = await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: caja1, clienteId: custWithRnc.result.id,
    versionConfiguracion: snap.state.configuracionVersion,
    condicion: 'Contado', metodoPago: 'tarjeta', tipoComprobante: 'B01',
    descuentoPorcentaje: 10,
    items: [{ productoId: prod.result.id, versionProducto: prodRow().version, nivelPrecio: 'precio1', cantidad: '1' }],
  });
  const receipt = receiptFromConfirmation(saleWithDisc);
  assert.equal(receipt.totals.grossTotal, 1000);
  assert.equal(receipt.totals.discount, 100);
  assert.equal(receipt.totals.total, 900);

  snap = await readSnapshot(pool, 'Prueba');
  await write('POST', '/api/caja/movimiento', {
    databaseId: dbId, cajaId: caja1, version: snap.state.caja.session.version,
    tipo: 'salida', monto: '500', concepto: 'Compra menor',
  });
  snap = await readSnapshot(pool, 'Prueba');
  await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: caja1, clienteId: contado.id,
    versionConfiguracion: snap.state.configuracionVersion,
    condicion: 'Contado', metodoPago: 'efectivo', tipoComprobante: 'B02',
    items: [{ productoId: prod.result.id, versionProducto: prodRow().version, nivelPrecio: 'precio1', cantidad: '1' }],
  });
  // Anular cashSale1 (1000): caja baja de 1500 a 500
  snap = await readSnapshot(pool, 'Prueba');
  const cs1Doc = snap.state.facturas.find(f => f.id === cashSale1.result.id);
  await write('POST', `/api/ventas/${cs1Doc.id}/anular`, {
    databaseId: dbId, version: cs1Doc.version, motivo: 'Corrección de caja',
  });

  // 4. Bug #3: 2 compras a crédito del mismo suplidor pagadas parcialmente en efectivo
  snap = await readSnapshot(pool, 'Prueba');
  const compra1 = await write('POST', '/api/compras', {
    databaseId: dbId, suplidorId: supplier.result.id, numero: 'SUP-001', fecha: '2026-11-20',
    condicion: 'Credito', vencimiento: '2026-12-20',
    items: [{ productoId: prod.result.id, versionProducto: prodRow().version, codigo: 'AUD-V2', nombre: 'Repuesto Auditoría', cantidad: '2', costo: '450.0000', precio1: '1000.0000', precio2: '900.0000', precio3: '800.0000' }],
  });
  snap = await readSnapshot(pool, 'Prueba');
  const compra2 = await write('POST', '/api/compras', {
    databaseId: dbId, suplidorId: supplier.result.id, numero: 'SUP-002', fecha: '2026-11-21',
    condicion: 'Credito', vencimiento: '2026-12-21',
    items: [{ productoId: prod.result.id, versionProducto: prodRow().version, codigo: 'AUD-V2', nombre: 'Repuesto Auditoría', cantidad: '2', costo: '450.0000', precio1: '1000.0000', precio2: '900.0000', precio3: '800.0000' }],
  });
  snap = await readSnapshot(pool, 'Prueba');
  const c1 = snap.state.compras.find(c => c.id === compra1.result.id);
  const c2 = snap.state.compras.find(c => c.id === compra2.result.id);
  await write('POST', '/api/cuentas/pagos', {
    databaseId: dbId, compraId: c1.id, version: c1.version, monto: '100', metodoPago: 'efectivo', cajaId: caja1,
  });
  await write('POST', '/api/cuentas/pagos', {
    databaseId: dbId, compraId: c2.id, version: c2.version, monto: '100', metodoPago: 'efectivo', cajaId: caja1,
  });

  // 5. Bug #1: venta a crédito en turno 1 -> cerrar turno 1 -> anular venta a crédito después del cierre
  snap = await readSnapshot(pool, 'Prueba');
  const creditSale = await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: caja1, clienteId: custWithRnc.result.id,
    versionConfiguracion: snap.state.configuracionVersion,
    condicion: 'Credito', metodoPago: 'credito', tipoComprobante: 'B01', vencimiento: '2026-12-30',
    items: [{ productoId: prod.result.id, versionProducto: prodRow().version, nivelPrecio: 'precio1', cantidad: '1' }],
  });
  snap = await readSnapshot(pool, 'Prueba');
  await write('POST', '/api/caja/cerrar', {
    databaseId: dbId, cajaId: caja1, version: snap.state.caja.session.version, conteo: String(snap.state.caja.summary.expected),
  });
  // Anular venta a crédito después de cerrado el turno
  snap = await readSnapshot(pool, 'Prueba');
  const creditDoc = snap.state.facturas.find(f => f.id === creditSale.result.id);
  await write('POST', `/api/ventas/${creditDoc.id}/anular`, {
    databaseId: dbId, version: creditDoc.version, motivo: 'Devolución posterior al cierre',
  });

  // Perf check: movimientos_caja del turno cerrado NO se devuelven en snapshot
  const afterCloseSnap = await readSnapshot(pool, 'Prueba');
  assert.equal(afterCloseSnap.state.caja.movements.length, 0);

  // Perf check: fallback compacto en writeOperation con { compact: true }
  const compactWrite = await write('POST', '/api/clientes', {
    databaseId: dbId, nombre: 'Cliente Compacto', rnc: '',
  }, { compact: true });
  assert.equal(compactWrite.compact, 1);
  assert.ok(Array.isArray(compactWrite.state.productos[0]));

  // Verificar que POST /api/restore pasa validateCashRestore() con Bugs #1, #2 y #9 presentes!
  const fullBackup = await readSnapshot(pool, 'Prueba', true);
  const currentSnap = await readSnapshot(pool, 'Prueba');
  const restored = await write('POST', '/api/restore', {
    databaseId: currentSnap.databaseId,
    revision: currentSnap.revision,
    backup: fullBackup,
  });
  assert.ok(restored.databaseId !== currentSnap.databaseId);

  // 6. Verificar Bug #3 en DesktopEngine real con bootstrap redactado para cajero (2 compras del mismo suplidor)
  const rawBootstrap = await readSyncBootstrap(pool, 'Prueba');
  const cajeroBootstrap = redactBootstrapForRole(rawBootstrap, 'cajero');
  assert.equal(cajeroBootstrap.backup.tables.compras.length, 2);
  assert.notEqual(cajeroBootstrap.backup.tables.compras[0].numero, cajeroBootstrap.backup.tables.compras[1].numero);

  const dir1 = await mkdtemp(join(tmpdir(), 'felix-audit-v2-cajero-'));
  tempDirs.push(dir1);
  engineCajero = new DesktopEngine(new DesktopLedger(dir1));
  await engineCajero.adopt(cajeroBootstrap);
  const cajeroSnap = await engineCajero.snapshot();
  assert.equal(cajeroSnap.state.productos.find(p => p.codigo === 'AUD-V2').costoExacto, '0.0000');

  // 7. Bug #6: cola sync de Desktop marca conflict ante HTTP 403 y 404
  const clientRes = await engineCajero.write('POST', '/api/clientes', {
    databaseId: cajeroSnap.databaseId, nombre: 'Cliente Offline 403',
  }, randomUUID(), { id: 'cajero-1', name: 'cajero', role: 'cajero', generation: 'g1' });
  assert.ok(clientRes.result.id);
  for (const status of [403, 404]) {
    const syncRes = await engineCajero.synchronize(async path => {
      if (path === '/api/sync/operations') {
        const err = new Error(`Rechazo ${status}`);
        err.status = status;
        throw err;
      }
      return cajeroBootstrap;
    }, { id: 'cajero-1', name: 'cajero', role: 'cajero', generation: 'g1' }, true);
    assert.equal(syncRes.connection, 'conflict', `HTTP ${status} debe marcar conflict y no deadlock offline`);
    assert.ok(syncRes.conflict, `HTTP ${status} debe exponer el conflicto para conciliación`);
  }

  // 8. Bug #5: cambio de rol cajero -> dueno en desktopServer adopta bootstrap completo sincrónicamente en /login
  const dir2 = await mkdtemp(join(tmpdir(), 'felix-audit-v2-role-'));
  tempDirs.push(dir2);
  const ledger2 = new DesktopLedger(dir2);
  engine2 = new DesktopEngine(ledger2);
  let activeRole = 'cajero';
  const fakeRemote = {
    cookie: '',
    clear() {},
    invalidatePending() {},
    async request(path) {
      if (path === '/login') return { redirect: '/ventas' };
      if (path === '/api/account') return { id: activeRole === 'cajero' ? 'u-cajero' : 'u-dueno', username: activeRole, role: activeRole };
      if (path === '/api/sync/bootstrap') {
        return activeRole === 'cajero' ? cajeroBootstrap : rawBootstrap;
      }
      return {};
    },
  };
  srv = desktopServer(engine2, fakeRemote, dir2);
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const loginAs = async (username) => {
    const r = await fetch(base + '/login', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'secret', remember: false }),
    });
    assert.equal(r.status, 200, await r.text());
    return r.headers.get('set-cookie').split(';')[0];
  };
  const cajeroCookie = await loginAs('cajero');
  const sCajero = await (await fetch(base + '/api/state', { headers: { Cookie: cajeroCookie } })).json();
  assert.equal(sCajero.state.productos.find(p => p.codigo === 'AUD-V2').costoExacto, '0.0000');

  activeRole = 'dueno';
  const duenoCookie = await loginAs('dueno');
  const sDueno = await (await fetch(base + '/api/state', { headers: { Cookie: duenoCookie } })).json();
  assert.equal(sDueno.state.productos.find(p => p.codigo === 'AUD-V2').costoExacto, '450.0000');
});

test('auditoría v2: productForBarcode indexado O(1) en 8,000 productos conserva exactitud y ambigüedad', () => {
  const products = Array.from({ length: 8000 }, (_, i) => ({
    id: i + 1,
    code: `BAR-${String(i + 1).padStart(5, '0')}`,
    altCodes: i === 7999 ? ['0746000080001'] : i === 5000 ? ['DUP-CODE'] : i === 5001 ? ['dup-code'] : [],
    name: `Producto ${i + 1}`,
  }));
  assert.equal(productForBarcode(products, '746000080001', 'UPC_A').id, 8000);
  assert.equal(productForBarcode(products, '0746000080001', 'EAN_13').id, 8000);
  assert.equal(productForBarcode(products, 'DUP-CODE').id, 5001);
  assert.throws(() => productForBarcode(products, 'Dup-Code'), /varios artículos/);
  const t0 = performance.now();
  for (let i = 0; i < 500; i++) {
    assert.equal(productForBarcode(products, 'BAR-07999').id, 7999);
  }
  const perScan = (performance.now() - t0) / 500;
  assert.ok(perScan < 1, `Cada escaneo indexado debe tomar <1 ms, tomó ${perScan.toFixed(4)} ms`);
});
