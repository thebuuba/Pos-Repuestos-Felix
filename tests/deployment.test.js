import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentConfig } from '../scripts/deploy-worker.mjs';

test('impide publicar en una cuenta, origen o Hyperdrive sin configurar', () => {
  // IDs de prueba; nunca se envían a Cloudflare.
  const config = { account_id: 'a'.repeat(32), hyperdrive: [{ binding: 'HYPERDRIVE', id: 'b'.repeat(32) }], vars: { PUBLIC_ORIGIN: 'https://pos.example' } };
  assert.doesNotThrow(() => validateDeploymentConfig(config));
  assert.throws(() => validateDeploymentConfig({ ...config, account_id: '' }), /cuenta/);
  assert.throws(() => validateDeploymentConfig({ ...config, hyperdrive: [] }), /Hyperdrive/);
  assert.throws(() => validateDeploymentConfig({ ...config, hyperdrive: [{ binding: 'HYPERDRIVE', id: '0'.repeat(32) }] }), /Hyperdrive/);
  assert.throws(() => validateDeploymentConfig({ ...config, vars: { PUBLIC_ORIGIN: 'http://pos.example' } }), /HTTPS/);
});
