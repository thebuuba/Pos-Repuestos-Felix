import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig } from '../src/db/config.js';
import pg from 'pg';

test('local puede conectarse sin SSL y remoto exige un certificado válido', () => {
  const local = databaseConfig({ DATABASE_URL: 'postgresql://user:password@127.0.0.1/pos' });
  assert.equal(local.ssl, false);
  const remote = databaseConfig({
    DATABASE_URL: 'postgresql://user:password@pooler.supabase.com/postgres?sslmode=no-verify', DATABASE_SSL: 'false',
  });
  assert.equal(remote.ssl.rejectUnauthorized, true);
  assert.equal(new URL(remote.connectionString).searchParams.has('sslmode'), false);
});

test('los parámetros de URL no pueden desactivar SSL en el controlador', () => {
  const config = databaseConfig({ DATABASE_URL: 'postgresql://user:password@remote.example/postgres?ssl=0' });
  const client = new pg.Client(config);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
});

test('la URL no permite reemplazar un host local mediante un parámetro', () => {
  assert.throws(() => databaseConfig({
    DATABASE_URL: 'postgresql://user:password@127.0.0.1/pos?host=remote.example',
  }), /parámetros/);
});

test('no habilita un servidor público sin HTTPS y contraseña suficiente', async () => {
  const { hostingConfig } = await import('../src/hosting.js');
  assert.throws(() => hostingConfig({ HOST: '0.0.0.0' }), /PUBLIC_ORIGIN/);
  assert.throws(() => hostingConfig({ PUBLIC_ORIGIN: 'http://pos.example' }), /HTTPS/);
  assert.throws(() => hostingConfig({ PUBLIC_ORIGIN: 'https://pos.example', APP_PASSWORD: '123' }), /contraseña/);
  assert.equal(hostingConfig({}).host, '127.0.0.1');
});

test('acepta la CA desde una variable privada del alojamiento conservando verificación TLS', () => {
  const pem = '-----BEGIN CERTIFICATE-----\ncontenido-de-prueba\n-----END CERTIFICATE-----';
  const config = databaseConfig({ DATABASE_URL: 'postgresql://user:password@remote.example/postgres', DATABASE_CA: pem.replaceAll('\n', '\\n') });
  assert.equal(config.ssl.ca, pem);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.throws(() => databaseConfig({ DATABASE_URL: 'postgresql://user:password@remote.example/postgres', DATABASE_CA: pem, DATABASE_CA_FILE: 'archivo-no-usado.crt' }), /DATABASE_CA/);
});
