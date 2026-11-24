import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { testAuthService, loginCookie } from './fixtures/supabase-auth.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { hostingConfig } from '../src/hosting.js';

test('tres sesiones del mismo usuario confirman ventas concurrentes sin perder acceso, existencias ni caja',
  { timeout: 60000 }, async () => {
    let database, admin, pool, server, authService;
    try {
      database = await temporaryPostgres();
      admin = new pg.Pool({ connectionString: database.connectionString });
      await migrateDatabase(admin);
      pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
      authService = await testAuthService();
      server = await createApp(pool, {
        hosting: hostingConfig(authService.env),
        databaseLabel: 'Tres sesiones de prueba',
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = 'http://127.0.0.1:' + server.address().port;
      const call = (path, options = {}, cookie = '') => fetch(origin + path, {
        ...options,
        headers: { ...options.headers, Origin: origin, ...(cookie && { Cookie: cookie }) },
      });
      const json = async response => {
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        return body;
      };
      assert.equal((await call('/api/state')).status, 401);
      const sessions = [];
      for (let index = 0; index < 3; index++) {
        sessions.push(await loginCookie(call));
        // Every earlier login must remain authorized after opening the next one.
        const accounts = await Promise.all(sessions.map(cookie => call('/api/account', {}, cookie).then(json)));
        assert.ok(accounts.every(account => account.id === 'fixture-user' && account.username === 'felix'));
      }
      assert.equal(new Set(sessions).size, 3, 'Cada inicio recibe su propia cookie de sesión.');
      const initial = await json(await call('/api/state', {}, sessions[0]));
      const databaseId = initial.databaseId;
      const write = (cookie, path, payload, key = randomUUID()) => call(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ databaseId, ...payload }),
      }, cookie).then(json);
      await write(sessions[0], '/api/caja/abrir', { monto: '100' });
      for (const [index, price] of ['10.0030', '20.1250', '30.2000'].entries()) {
        await write(sessions[index], '/api/productos', {
          codigo: `SESION-${index + 1}`, nombre: `Artículo de sesión ${index + 1}`,
          costo: '1.0000', precio1: price, precio2: price, precio3: price,
          stock: [5, 6, 7][index], gravado: false,
        });
      }
      const before = await json(await call('/api/state', {}, sessions[0]));
      const customer = before.state.clientes.find(row => row.esContado);
      const products = ['SESION-1', 'SESION-2', 'SESION-3'].map(code => before.state.productos.find(row => row.codigo === code));
      const keys = sessions.map(() => randomUUID());
      const payloads = products.map((product, index) => ({
        cajaId: before.state.caja.session.id, clienteId: customer.id,
        condicion: 'Contado', tipoComprobante: 'B02',
        metodoPago: ['efectivo', 'tarjeta', 'transferencia'][index],
        versionConfiguracion: before.state.configuracionVersion,
        items: [{ productoId: product.id, versionProducto: product.version,
          cantidad: ['2.50', '2.00', '3.00'][index], nivelPrecio: 'precio1' }],
      }));
      // All requests carry the versions read before any of the three sales.
      const results = await Promise.all(sessions.map((cookie, index) =>
        write(cookie, '/api/ventas', payloads[index], keys[index])));
      assert.equal(new Set(results.map(result => result.result.id)).size, 3);
      for (const [index, result] of results.entries()) {
        assert.deepEqual(result.confirmation, {
          operationId: keys[index], databaseId, method: 'POST', path: '/api/ventas', replayed: false,
        });
        const invoice = result.state.facturas.find(row => row.id === result.result.id);
        assert.equal(invoice.total, [25, 40, 91][index]);
        assert.equal(invoice.ncf, null);
      }
      const snapshots = await Promise.all(sessions.map(cookie => call('/api/state', {}, cookie).then(json)));
      assert.deepEqual(snapshots[1], snapshots[0]);
      assert.deepEqual(snapshots[2], snapshots[0]);
      const state = snapshots[0].state;
      assert.equal(state.facturas.length, 3);
      assert.deepEqual(products.map(product => state.productos.find(row => row.id === product.id).stock), [2.5, 4, 4]);
      assert.deepEqual(products.map(product => state.productos.find(row => row.id === product.id).version),
        products.map(product => product.version + 1));
      assert.equal(state.caja.session.open, true);
      assert.equal(state.caja.session.cashier, 'felix');
      assert.equal(state.caja.session.version, before.state.caja.session.version + 3);
      assert.deepEqual(state.caja.summary, {
        opening: 100, cashSales: 25, cardSales: 40, transferSales: 91, creditSales: 0,
        entradas: 0, salidas: 0, cobros: 0, pagos: 0, expected: 125, roundingAdjustment: 0, invoices: 3,
      });
      assert.deepEqual((await admin.query('SELECT count(*)::int AS count, sum(total)::text AS total FROM ventas')).rows,
        [{ count: 3, total: '156.00' }]);
      assert.deepEqual((await admin.query('SELECT codigo, stock::text FROM productos ORDER BY codigo')).rows, [
        { codigo: 'SESION-1', stock: '2.50' }, { codigo: 'SESION-2', stock: '4.00' }, { codigo: 'SESION-3', stock: '4.00' },
      ]);
      const retries = await Promise.all(sessions.map((cookie, index) =>
        write(cookie, '/api/ventas', payloads[index], keys[index])));
      assert.deepEqual(retries.map(result => result.result.id), results.map(result => result.result.id));
      assert.ok(retries.every(result => result.confirmation.replayed));
      assert.deepEqual(await json(await call('/api/state', {}, sessions[0])), snapshots[0],
        'Reintentar las tres confirmaciones conserva exactamente facturas, existencias, versiones y caja.');
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      await authService?.close();
      await pool?.end();
      await admin?.end();
      await database?.stop();
    }
  });
