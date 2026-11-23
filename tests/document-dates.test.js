import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const moduleUrl = new URL('../frontend/src/lib/accounts.js', import.meta.url);

for (const [TZ, offset] of [['UTC', 0], ['America/Santo_Domingo', 240]]) {
  test(`formats documentary dates and business instants from ${TZ}`, () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-'], {
      env: { ...process.env, TZ },
      encoding: 'utf8',
      input: `
        import { formatDate, formatDateTime, formatTime } from ${JSON.stringify(moduleUrl.href)};
        const formats = (value) => [formatDate(value), formatDateTime(value), formatTime(value)];
        console.log(JSON.stringify({
          offset: new Date('2026-01-01T00:00:00Z').getTimezoneOffset(),
          documentary: formats('2026-01-01'),
          instant: formats('2026-01-02T02:15:00Z'),
        }));
      `,
    });
    assert.deepEqual(JSON.parse(output), {
      offset,
      documentary: ['01 ene de 2026', '01-ene', ''],
      instant: ['01 ene de 2026', '01-ene, 10:15 p. m.', '10:15 p. m.'],
    });
  });
}
