import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboardScan } from '../frontend/src/data/barcode-scanner.js';

test('reconoce ráfagas completas con Enter, conserva ceros y distingue pausas', () => {
  const scanner = createKeyboardScan();
  let now = 0;
  const key = (key, delay = 10, options = {}) => scanner.push({ key, timeStamp: now += delay, ...options });
  const scan = (code, delay = 10) => { for (const char of code) key(char, delay); return key('Enter', delay); };
  assert.equal(scan('001234'), '001234');
  assert.equal(scan('ABC-123'), 'ABC-123');
  assert.equal(scan('AB CD'), 'AB CD');
  assert.equal(scan('sint-7681 '), 'sint-7681 ');
  key('A'); key(' ', 60); key('B'); key('C'); key('D');
  assert.equal(key('Enter'), 'A BCD', 'La media final puede ser válida aunque el primer intervalo sea mayor');
  assert.equal(scan('001234', 120), null);
  assert.equal(scan('123'), null);
  key('A'); key('B', 90); key('C'); key('D'); key('E'); key('F');
  assert.equal(key('Enter'), null, 'No acepta el final de una lectura partida');
  key('0'); key('0'); key('0', 10, { repeat: true }); key('1');
  assert.equal(key('Enter'), null);
  assert.equal(scan('X'.repeat(257)), null);
  assert.equal(scan('X'.repeat(1000) + '0001'), null, 'No acepta la cola de una lectura demasiado larga');
  key('0'); key('0'); scanner.reset(); key('1'); key('2');
  assert.equal(key('Enter'), null, 'No mezcla lecturas entre focos o pantallas');
  key('0'); key('0'); key('Shift'); key('A'); key('B');
  assert.equal(key('Enter'), '00AB', 'Shift del lector no rompe códigos en mayúsculas');
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
    for (const char of '001234') key(char, 5, { [modifier]: true });
    assert.equal(key('Enter'), null);
  }
});
