import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { redactBootstrapForRole, redactSnapshotForRole } from '../src/pos/roles.js';
import { handleRequest } from '../src/http/app.js';
import { hostingConfig } from '../src/hosting.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { desktopServer } from '../src/desktop/server.js';
import { passwordRecord, tokenHash } from '../src/desktop/credentials.js';
import { daysOverdue } from '../frontend/src/lib/accounts.js';
import { reportData } from '../frontend/src/lib/sales-analytics.js';

test('cabeceras de seguridad web (CSP, Referrer-Policy, HSTS) y /theme.js público', async () => {
  const origin = 'https://pos.example';
  const hosting = hostingConfig({ PUBLIC_ORIGIN: origin, APP_USERNAME: 'felix', APP_PASSWORD: 'clave-de-pruebas-12345' });
  const req = path => new Request(origin + path, { headers: { 'X-Forwarded-Proto': 'https' } });
  const forbiddenPool = { connect() { throw new Error('No DB'); } };

  const res = await handleRequest(req('/theme.js'), { pool: forbiddenPool, hosting, readAsset: () => '/* theme */' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('referrer-policy'), 'same-origin');
  assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
});

test('fechas de vencimiento en America/Santo_Domingo y reportes con descuento prorrateado y métodos reales', () => {
  // 2026-11-23T01:30:00Z = 2026-11-22 21:30 en Santo Domingo (UTC-4) -> vence hoy (0 días), no vencida.
  assert.equal(daysOverdue({ dueDate: '2026-11-22' }, new Date('2026-11-23T01:30:00Z')), 0);
  assert.equal(daysOverdue({ dueDate: '2026-11-22' }, new Date('2026-11-23T04:01:00Z')), 1);

  const products = [
    { id: 1, category: 'Frenos', cost: 100 },
    { id: 2, category: 'Motor', cost: 200 },
  ];
  // Venta con descuento de 20%: bruto base 1000 (600 + 400), netBase 800, itbis 144, total 944.
  const discountedSale = {
    id: 1, number: 'Registro 1', customerName: 'Cliente A', date: '2026-11-22',
    condition: 'contado', method: 'tarjeta', comprobante: 'B02',
    subtotal: 800, netBase: 800, discount: 236, itbis: 144, total: 944, status: 'pagada',
    lines: [
      { productId: 1, code: 'P1', name: 'Pastilla', quantity: 1, base: 600, subtotal: 708 },
      { productId: 2, code: 'P2', name: 'Filtro', quantity: 1, base: 400, subtotal: 472 },
    ],
  };
  const report = reportData([discountedSale], products, 'hoy', '2026-11-22', true);
  assert.equal(report.net, '800.00');
  const sumTop = report.top.reduce((s, r) => s + Number(r.revenue), 0);
  const sumCat = report.categories.reduce((s, [, v]) => s + Number(v), 0);
  assert.equal(sumTop, 800);
  assert.equal(sumCat, 800);
  assert.equal(report.methods.find(m => m.key === 'tarjeta')?.total, '944.00');
});

test('compras bloquea código alternativo, anulación crédito offline no genera falso conflicto de caja, redacción cajero y delta desktop', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-audit-'));
  const dirCashier = await mkdtemp(join(tmpdir(), 'felix-audit-cashier-'));
  const database = await temporaryPostgres();
  const cloud = new pg.Pool({ connectionString: database.connectionString });
  let engine, cashierEngine, server;
  t.after(async () => {
    if (server) await new Promise(done => server.close(done));
    await engine?.close();
    await cashierEngine?.close();
    await cloud.end();
    await database.stop();
    await rm(dir, { recursive: true, force: true });
    await rm(dirCashier, { recursive: true, force: true });
  });

  await migrateDatabase(cloud);
  const actor = { id: randomUUID(), name: 'Dueño' };
  const remote = (path, options) => path === '/api/sync/bootstrap'
    ? readSyncBootstrap(cloud, 'Nube')
    : writeSyncOperation(cloud, options.body, 'Nube', actor);

  const initial = await readSnapshot(cloud, 'Nube');
  const dbId = initial.databaseId;
  const sup = await writeOperation(cloud, 'POST', '/api/suplidores', { databaseId: dbId, nombre: 'Suplidor Uno' }, randomUUID(), 'Nube', actor);
  const cust = await writeOperation(cloud, 'POST', '/api/clientes', { databaseId: dbId, nombre: 'Taller Crédito', limiteCredito: '5000' }, randomUUID(), 'Nube', actor);
  const prod = await writeOperation(cloud, 'POST', '/api/productos', {
    databaseId: dbId, codigo: 'PRI-1', codigosAlternativos: ['ALT-999'], nombre: 'Bujía',
    costo: '100', precio1: '250', precio2: '220', precio3: '200', stock: '10',
  }, randomUUID(), 'Nube', actor);

  // 1. Compras rechaza crear artículo usando código alternativo existente (case-insensitive)
  await assert.rejects(
    writeOperation(cloud, 'POST', '/api/compras', {
      databaseId: dbId, suplidorId: sup.result.id, numero: 'FAC-ALT-1',
      items: [{ codigo: 'alt-999', nombre: 'Duplicado', cantidad: '2', costo: '90', precio1: '200', precio2: '180', precio3: '160' }],
    }, randomUUID(), 'Nube', actor),
    error => error.status === 409 && /código alternativo/.test(error.message),
  );

  // Compra a crédito válida para verificar redacción cajero
  const buy = await writeOperation(cloud, 'POST', '/api/compras', {
    databaseId: dbId, suplidorId: sup.result.id, numero: 'FAC-CR-1', condicion: 'Credito',
    items: [{ productoId: prod.result.id, versionProducto: 1, codigo: 'PRI-1', nombre: 'Bujía', cantidad: '2', costo: '100', precio1: '250', precio2: '220', precio3: '200' }],
  }, randomUUID(), 'Nube', actor);
  await writeOperation(cloud, 'POST', '/api/cuentas/pagos', {
    databaseId: dbId, compraId: buy.result.id, version: 1, monto: '50', metodoPago: 'transferencia', referencia: 'TR-1', nota: 'Pago',
  }, randomUUID(), 'Nube', actor);

  // 2. Redacción completa para rol cajero en snapshot y bootstrap
  const fullSnap = await readSnapshot(cloud, 'Nube');
  const redactedSnap = redactSnapshotForRole(fullSnap, 'cajero');
  assert.equal(redactedSnap.state.productos[0].costo, 0);
  assert.equal(redactedSnap.state.compras.length, 0);
  assert.equal(redactedSnap.state.suplidores[0].deuda, 0);
  assert.equal(redactedSnap.state.abonos.some(a => a.tipo === 'pago'), false);
  assert.equal(redactedSnap.state.movimientos.some(m => m.tipo === 'compra'), false);

  const rawBootstrap = await readSyncBootstrap(cloud, 'Nube');
  const cashierBootstrap = redactBootstrapForRole(rawBootstrap, 'cajero');
  assert.equal(cashierBootstrap.backup.tables.productos[0].costo, '0.0000');
  assert.equal(cashierBootstrap.backup.tables.compras.length, 0);
  assert.equal(cashierBootstrap.backup.tables.compra_detalles.length, 0);
  cashierEngine = new DesktopEngine(new DesktopLedger(dirCashier));
  await cashierEngine.adopt(cashierBootstrap);
  assert.equal((await cashierEngine.snapshot()).state.productos[0].stock, 12);

  // 3. Abrir caja, crear venta a crédito y probar delta desktop + anulación crédito offline sin falso conflicto de caja
  const turn = await writeOperation(cloud, 'POST', '/api/caja/abrir', { databaseId: dbId, monto: '1000' }, randomUUID(), 'Nube', actor);
  const beforeCredit = await readSnapshot(cloud, 'Nube');
  const pRow = beforeCredit.state.productos[0];
  const cRow = beforeCredit.state.clientes.find(c => c.id === cust.result.id);
  const creditSale = await writeOperation(cloud, 'POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: cRow.id, versionCliente: cRow.version,
    versionConfiguracion: beforeCredit.state.configuracionVersion,
    condicion: 'Credito', tipoComprobante: 'B02', metodoPago: 'credito',
    items: [{ productoId: pRow.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: pRow.version }],
  }, randomUUID(), 'Nube', actor);

  engine = new DesktopEngine(new DesktopLedger(dir));
  await engine.adopt(await remote('/api/sync/bootstrap'));

  // 3a. Delta desktop en POST /api/ventas con movimientosUpsert y localReceipt
  const snapLocal = await engine.snapshot();
  const contado = snapLocal.state.clientes.find(c => c.esContado);
  const localProd = snapLocal.state.productos[0];
  const saleResp = await engine.write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: snapLocal.state.caja.session.id, clienteId: contado.id,
    versionCliente: contado.version, versionConfiguracion: snapLocal.state.configuracionVersion,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: localProd.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: localProd.version }],
  }, randomUUID(), actor, { deltaBaseRevision: snapLocal.revision });
  assert.equal(saleResp.delta, true);
  assert.ok(saleResp.localReceipt);
  assert.equal(saleResp.changes.movimientosUpsert.length, 1);
  assert.equal(saleResp.changes.productosUpsert[0].stock, 10);

  // Sincronizar esa venta primero
  assert.equal((await engine.synchronize(remote, actor)).pending, 0);

  // 3b. Ahora otra venta ocurre en la web (avanza versión de caja) mientras Windows anula la venta a crédito offline
  const cloudNow = await readSnapshot(cloud, 'Nube');
  const cloudContado = cloudNow.state.clientes.find(c => c.esContado);
  const cloudProd = cloudNow.state.productos[0];
  await writeOperation(cloud, 'POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: cloudContado.id,
    versionCliente: cloudContado.version, versionConfiguracion: cloudNow.state.configuracionVersion,
    condicion: 'Contado', tipoComprobante: 'B02', metodoPago: 'efectivo',
    items: [{ productoId: cloudProd.id, cantidad: '1', nivelPrecio: 'precio1', versionProducto: cloudProd.version }],
  }, randomUUID(), 'Nube', actor);

  // En Windows offline, anular la venta a crédito
  const localCredit = (await engine.snapshot()).state.facturas.find(f => f.condicion === 'Credito');
  await engine.write('POST', `/api/ventas/${localCredit.id}/anular`, {
    databaseId: dbId, version: localCredit.version, motivo: 'Anulación crédito offline',
  }, randomUUID(), actor);
  const syncAfterVoid = await engine.synchronize(remote, actor);
  assert.equal(syncAfterVoid.pending, 0, JSON.stringify(syncAfterVoid));
  assert.equal(syncAfterVoid.conflict, null);
  const cloudFinal = await readSnapshot(cloud, 'Nube');
  assert.equal(cloudFinal.state.facturas.find(f => f.id === creditSale.result.id).estado, 'anulada');

  // 4. Desktop GET /api/account sin internet devuelve el perfil local con rol cajero
  const token = 'offline-test-token';
  const cajeroId = randomUUID();
  cashierEngine.ledger.set('profile', {
    id: cajeroId, username: 'cajero1', name: 'cajero1', role: 'cajero',
    generation: randomUUID(), ...passwordRecord('clave123'), onlineAt: Date.now(), allowOffline: true,
  });
  cashierEngine.ledger.database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), cajeroId, Date.now() + 3600_000);
  const offlineRemote = {
    cookie: null,
    clear() {},
    async request() { throw Object.assign(new Error('Sin red'), { status: 503 }); },
  };
  server = desktopServer(cashierEngine, offlineRemote, dirCashier);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const accountRes = await fetch(`http://127.0.0.1:${server.address().port}/api/account`, {
    headers: { Cookie: `felix-desktop=${token}` },
  });
  assert.equal(accountRes.status, 200);
  const accountBody = await accountRes.json();
  assert.equal(accountBody.role, 'cajero');
  assert.equal(accountBody.username, 'cajero1');
  assert.equal(accountBody.offline, true);
  assert.equal(accountBody.canChangePassword, false);
});
