import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { cashPresentation } from '../src/pos/cash-operations.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { desktopServer } from '../src/desktop/server.js';
import { passwordRecord } from '../src/desktop/credentials.js';

test('auditoría v3: C3 carrera movimientos_inventario, C4 anulación efectivo offline, A3 ETag W/, A4 cierre tras anulación tarjeta, A5 cookie en login fallido, B1, B2 y M6', { timeout: 120000 }, async t => {
  const db = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  const tempDirs = [];
  const engines = [];
  let desktopSrv;

  t.after(async () => {
    if (desktopSrv) {
      desktopSrv.closeAllConnections();
      if (desktopSrv.listening) await new Promise(resolve => desktopSrv.close(resolve));
    }
    for (const eng of engines) {
      await eng.pool?.end().catch(() => {});
      eng.ledger?.close();
    }
    await pool.end();
    await db.stop();
    for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  });

  await migrateDatabase(pool);
  const owner = { id: 'owner-v3', name: 'dueno', role: 'dueno' };
  const write = (method, path, body, ctx = {}) =>
    writeOperation(pool, method, path, body, randomUUID(), 'Nube', owner, ctx);

  let snap = await readSnapshot(pool, 'Nube');
  const dbId = snap.databaseId;

  // --- M6: cashPresentation debe ordenar closures por closedAt descendente sin depender de id ---
  const presented = cashPresentation({
    turnos_caja: [
      { id: 10, version: 2, cajero: 'a', fondo: '100.00', abierto_en: '2026-11-23T12:00:00.000Z', cerrado_en: '2026-11-23T18:00:00.000Z', esperado: '500.00', contado: '500.00', ventas: '400.00' },
      { id: 25, version: 2, cajero: 'b', fondo: '100.00', abierto_en: '2026-11-22T08:00:00.000Z', cerrado_en: '2026-11-22T17:00:00.000Z', esperado: '300.00', contado: '300.00', ventas: '200.00' },
    ],
    movimientos_caja: [],
    ventas: [],
    abonos_cuentas: [],
  });
  assert.equal(presented.closures[0].id, 10, 'El cierre más reciente debe aparecer primero aunque tenga un id menor');
  assert.equal(presented.closures[1].id, 25);

  // --- B1: eliminar suplidor inactivo NO debe bloquear la eliminación posterior de su fórmula ---
  const fRes = await write('POST', '/api/formulas', {
    databaseId: dbId, nombre: 'Formula Desechable', factorCosto: 1.18, recargo1: 30, recargo2: 20, recargo3: 10,
  });
  const sRes = await write('POST', '/api/suplidores', {
    databaseId: dbId, nombre: 'Suplidor Temporal', rnc: '130999888', formulaId: fRes.result.id,
  });
  snap = await readSnapshot(pool, 'Nube');
  const supRow = snap.state.suplidores.find(s => s.id === sRes.result.id);
  const fRow = snap.state.formulas.find(f => f.id === fRes.result.id);
  // Mientras el suplidor está activo, la fórmula no se puede borrar
  await assert.rejects(
    write('DELETE', `/api/formulas/${fRow.id}`, { databaseId: dbId, version: fRow.version }),
    err => err.status === 409,
  );
  // Al eliminar el suplidor, la fórmula ya se puede eliminar sin 409
  await write('DELETE', `/api/suplidores/${supRow.id}`, { databaseId: dbId, version: supRow.version });
  const delF = await write('DELETE', `/api/formulas/${fRow.id}`, { databaseId: dbId, version: fRow.version });
  assert.equal(delF.result.id, fRow.id);

  // Crear dos productos y un cliente
  const p1 = await write('POST', '/api/productos', {
    databaseId: dbId, codigo: 'V3-P1', nombre: 'Filtro V3 A',
    costo: '100.0000', precio1: '500.0000', precio2: '450.0000', precio3: '400.0000', stock: '20',
  });
  const p2 = await write('POST', '/api/productos', {
    databaseId: dbId, codigo: 'V3-P2', nombre: 'Bujía V3 B',
    costo: '50.0000', precio1: '200.0000', precio2: '180.0000', precio3: '150.0000', stock: '20',
  });
  snap = await readSnapshot(pool, 'Nube');
  const contado = snap.state.clientes.find(c => c.esContado);

  // --- B2: no permitir desactivar un producto con piezas despachadas en cuenta de taller abierta ---
  const wAcc = await write('POST', '/api/taller', {
    databaseId: dbId, clienteId: contado.id, mecanico: 'Juan', vehiculo: 'Corolla',
    items: [{ productoId: p2.result.id, nivelPrecio: 'precio1', cantidad: '2' }],
  });
  snap = await readSnapshot(pool, 'Nube');
  const p2Live = snap.state.productos.find(p => p.id === p2.result.id);
  await assert.rejects(
    write('DELETE', `/api/productos/${p2Live.id}`, { databaseId: dbId, version: p2Live.version }),
    err => err.status === 409 && /taller abierta/i.test(err.message),
  );
  const wAccRow = snap.state.cuentasTaller.find(w => w.id === wAcc.result.id);
  await write('POST', `/api/taller/${wAccRow.id}/cancelar`, { databaseId: dbId, version: wAccRow.version, motivo: 'Prueba B2' });
  // Ahora con piezas devueltas, el producto sí se puede desactivar (creamos otro para seguir probando)
  snap = await readSnapshot(pool, 'Nube');
  const p2AfterCancel = snap.state.productos.find(p => p.id === p2.result.id);
  const delP2 = await write('DELETE', `/api/productos/${p2AfterCancel.id}`, { databaseId: dbId, version: p2AfterCancel.version });
  assert.equal(delP2.result.id, p2AfterCancel.id);

  // Re-crear p2b para pruebas de sincronización concurrente
  const p2b = await write('POST', '/api/productos', {
    databaseId: dbId, codigo: 'V3-P2B', nombre: 'Bujía V3 Concurrente',
    costo: '50.0000', precio1: '200.0000', precio2: '180.0000', precio3: '150.0000', stock: '20',
  });

  // --- A4: anular venta con tarjeta de turno abierto debe incrementar turnos_caja.version ---
  const turn = await write('POST', '/api/caja/abrir', { databaseId: dbId, monto: '0' });
  const cajaId = turn.result.id;
  snap = await readSnapshot(pool, 'Nube');
  const p1Row = () => snap.state.productos.find(p => p.id === p1.result.id);
  const cardSale = await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId, clienteId: contado.id,
    condicion: 'Contado', metodoPago: 'tarjeta', tipoComprobante: 'B02',
    versionConfiguracion: snap.state.configuracion.version,
    items: [{ productoId: p1.result.id, versionProducto: p1Row().version, nivelPrecio: 'precio1', cantidad: '1' }],
  });
  snap = await readSnapshot(pool, 'Nube');
  const staleCashVersion = snap.state.caja.session.version;
  const cardSaleDoc = snap.state.facturas.find(f => f.id === cardSale.result.id);
  await write('POST', `/api/ventas/${cardSaleDoc.id}/anular`, {
    databaseId: dbId, version: cardSaleDoc.version, motivo: 'Anulación tarjeta',
  });
  snap = await readSnapshot(pool, 'Nube');
  assert.equal(snap.state.caja.session.version, staleCashVersion + 1, 'turnos_caja.version debe incrementarse al anular venta no-efectivo en turno abierto');
  await assert.rejects(
    write('POST', '/api/caja/cerrar', { databaseId: dbId, cajaId, version: staleCashVersion, contado: '0' }),
    err => err.status === 409,
  );

  // --- C3 + A3 + C4: pruebas de DesktopEngine y sync ---
  // Preparar una venta en efectivo de RD$ 500 y dos cuentas de taller abiertas antes de adoptar en Desktop
  snap = await readSnapshot(pool, 'Nube');
  const cashSale = await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId, clienteId: contado.id,
    condicion: 'Contado', metodoPago: 'efectivo', tipoComprobante: 'B02',
    versionConfiguracion: snap.state.configuracion.version,
    items: [{ productoId: p1.result.id, versionProducto: snap.state.productos.find(p => p.id === p1.result.id).version, nivelPrecio: 'precio1', cantidad: '1' }],
  });
  const wCloud = await write('POST', '/api/taller', { databaseId: dbId, clienteId: contado.id, mecanico: 'Nube', vehiculo: 'A' });
  const wDesk = await write('POST', '/api/taller', { databaseId: dbId, clienteId: contado.id, mecanico: 'Desk', vehiculo: 'B' });

  const dir = await mkdtemp(join(tmpdir(), 'felix-v3-desk-'));
  tempDirs.push(dir);
  const ledger = new DesktopLedger(dir);
  const engine = new DesktopEngine(ledger);
  engines.push(engine);

  const boot = await readSyncBootstrap(pool, 'Nube');
  await engine.adopt({ ...boot, etag: `W/${boot.etag}` });

  // A3: sincronizar cuando el servidor responde 304 con ETag sin prefijo W/ (habiendo guardado W/ en bootstrap)
  const weakCheckStatus = await engine.synchronize(async (path, opts) => {
    if (path === '/api/sync/bootstrap') {
      assert.equal(opts.etag, `W/${boot.etag}`);
      return { notModified: true, etag: boot.etag };
    }
    throw new Error('Ruta inesperada: ' + path);
  }, owner);
  assert.equal(weakCheckStatus.connection, 'online', 'Desktop debe aceptar 304 cuando solo cambia el prefijo W/ del ETag');
  assert.equal(weakCheckStatus.error, null);

  // C3: simular carrera concurrente en movimientos_inventario (un movimiento de otro despacho aparece con id > priorMovement)
  const localSnap = await engine.snapshot();
  const wDeskLocal = localSnap.state.cuentasTaller.find(w => w.id === wDesk.result.id);
  const p1Local = localSnap.state.productos.find(p => p.id === p1.result.id);
  await engine.write('POST', `/api/taller/${wDeskLocal.id}/despachar`, {
    databaseId: dbId, version: wDeskLocal.version,
    items: [{ productoId: p1Local.id, versionProducto: p1Local.version, nivelPrecio: 'precio1', cantidad: '1' }],
  }, randomUUID(), owner);

  // En paralelo: un cliente Web inserta un despacho en otra cuenta de taller mientras Windows sincroniza el suyo
  const cloudNow = await readSnapshot(pool, 'Nube');
  const wCloudLive = cloudNow.state.cuentasTaller.find(w => w.id === wCloud.result.id);
  const p2bLive = cloudNow.state.productos.find(p => p.id === p2b.result.id);
  const syncRemote = async (path, options = {}) => {
    if (path === '/api/sync/operations') {
      const [webRes, syncRes] = await Promise.all([
        write('POST', `/api/taller/${wCloudLive.id}/despachar`, {
          databaseId: dbId, version: wCloudLive.version,
          items: [{ productoId: p2bLive.id, versionProducto: p2bLive.version, nivelPrecio: 'precio1', cantidad: '1' }],
        }),
        writeSyncOperation(pool, options.body, 'Nube', owner, { receiptOnly: true }),
      ]);
      assert.ok(webRes.result.id);
      assert.equal(syncRes.receipt.created.movimientos_inventario.length, 1, 'El recibo de sync solo debe incluir su propio movimiento de inventario');
      return syncRes;
    }
    if (path === '/api/sync/bootstrap') return readSyncBootstrap(pool, 'Nube');
    throw new Error('Ruta inesperada: ' + path);
  };
  const c3Status = await engine.synchronize(syncRemote, owner);
  assert.equal(c3Status.pending, 0, JSON.stringify(c3Status));
  assert.equal(c3Status.conflict, null);
  assert.equal(c3Status.connection, 'online');

  // C4: anulación offline de venta en efectivo tras una salida + venta online debe rechazarse como conflicto 409 (sin corromper validateCashRestore)
  const localBeforeVoid = await engine.snapshot();
  const cashSaleLocal = localBeforeVoid.state.facturas.find(f => f.id === cashSale.result.id);
  const localVoidOp = await engine.write('POST', `/api/ventas/${cashSaleLocal.id}/anular`, {
    databaseId: dbId, version: cashSaleLocal.version, motivo: 'Anulación offline tardía',
  }, randomUUID(), owner);
  assert.equal(localVoidOp.state.facturas.find(f => f.id === cashSaleLocal.id).estado, 'anulada');

  // En nube: salida de caja de RD$ 500 + venta efectivo RD$ 500 con timestamp posterior a la anulación offline
  await new Promise(r => setTimeout(r, 25));
  const snapBeforeOut = await readSnapshot(pool, 'Nube');
  await write('POST', '/api/caja/movimiento', {
    databaseId: dbId, cajaId, version: snapBeforeOut.state.caja.session.version,
    tipo: 'salida', monto: '500', concepto: 'Pago mensajero',
  });
  const snapBeforeSecondCash = await readSnapshot(pool, 'Nube');
  await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId, clienteId: contado.id,
    condicion: 'Contado', metodoPago: 'efectivo', tipoComprobante: 'B02',
    versionConfiguracion: snapBeforeSecondCash.state.configuracion.version,
    items: [{ productoId: p1.result.id, versionProducto: snapBeforeSecondCash.state.productos.find(p => p.id === p1.result.id).version, nivelPrecio: 'precio1', cantidad: '1' }],
  });

  const c4Status = await engine.synchronize(async (path, options = {}) => {
    if (path === '/api/sync/operations') return writeSyncOperation(pool, options.body, 'Nube', owner, { receiptOnly: true });
    if (path === '/api/sync/bootstrap') return readSyncBootstrap(pool, 'Nube');
    throw new Error('Ruta inesperada: ' + path);
  }, owner);
  assert.equal(c4Status.connection, 'conflict', 'La anulación offline de venta en efectivo tras movimientos en nube debe marcar conflicto');
  assert.ok(c4Status.conflict && /caja/i.test(c4Status.conflict), `Conflicto esperado de caja, recibido: ${c4Status.conflict}`);

  // Verificar que el respaldo de la nube sigue siendo 100% restaurable (validateCashRestore intacto)
  const cleanDir = await mkdtemp(join(tmpdir(), 'felix-v3-clean-'));
  tempDirs.push(cleanDir);
  const cleanEngine = new DesktopEngine(new DesktopLedger(cleanDir));
  engines.push(cleanEngine);
  await cleanEngine.adopt(await readSyncBootstrap(pool, 'Nube'));
  assert.equal((await cleanEngine.snapshot()).state.facturas.find(f => f.id === cashSale.result.id).estado, 'activa');

  // --- A5: fallo parcial en POST /login de desktopServer restaura remoteCookie del usuario anterior ---
  const assetsDir = await mkdtemp(join(tmpdir(), 'felix-v3-assets-'));
  tempDirs.push(assetsDir);
  await writeFile(join(assetsDir, 'index.html'), '<!doctype html><title>POS</title>');
  const srvDir = await mkdtemp(join(tmpdir(), 'felix-v3-srv-'));
  tempDirs.push(srvDir);
  const srvLedger = new DesktopLedger(srvDir);
  const srvEngine = new DesktopEngine(srvLedger);
  engines.push(srvEngine);
  await srvEngine.adopt(await readSyncBootstrap(pool, 'Nube'));
  const origProfile = {
    id: 'user-a', username: 'cajeroa', name: 'cajeroa', role: 'cajero',
    generation: randomUUID(), ...passwordRecord('clave123'), onlineAt: Date.now(), allowOffline: true,
  };
  srvLedger.set('profile', origProfile);
  srvLedger.set('remoteCookie', 'encrypted-cookie-a');

  const fakeRemote = {
    cookie: 'cookie-a',
    invalidatePending() {},
    clear() { this.cookie = null; srvLedger.set('remoteCookie', null); },
    async request(path) {
      if (path === '/login') {
        this.cookie = 'cookie-b';
        srvLedger.set('remoteCookie', 'encrypted-cookie-b');
        return { ok: true };
      }
      if (path === '/api/account') {
        throw Object.assign(new Error('Microcorte de red'), { status: 503 });
      }
      throw new Error('Unexpected path ' + path);
    },
  };
  desktopSrv = desktopServer(srvEngine, fakeRemote, assetsDir);
  await new Promise(resolve => desktopSrv.listen(0, '127.0.0.1', resolve));
  const port = desktopSrv.address().port;

  const loginRes = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ username: 'usuariob', password: 'otra-password' }),
  });
  assert.equal(loginRes.status, 401);
  assert.equal(fakeRemote.cookie, 'cookie-a', 'Debe restaurar remote.cookie al fallar parcialmente /login');
  assert.equal(srvLedger.get('remoteCookie'), 'encrypted-cookie-a', 'Debe restaurar remoteCookie en SQLite al fallar parcialmente /login');
  assert.equal(srvLedger.get('profile').id, 'user-a');
  assert.equal(srvLedger.get('profile').allowOffline, true);
});
