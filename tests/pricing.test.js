import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustedCost, pricesFromFormula } from '../frontend/src/lib/pricing.js';
import { normalizeFormula, calculateFormula, calculateCascadeFormula, calculateCascadeFromCost } from '../src/domain/pricing.js';

const f = {costFactor:'1.18',margins:{p1:'35',p2:'25',p3:'15'}};
const margins = {p1:0,p2:0,p3:0};
const maxCost = '999999999999.99';

test('normalizes a formula at the supported scales', () => {
  assert.deepEqual(normalizeFormula(f), {
    costFactor: '1.180000', margins: { p1: '35.0000', p2: '25.0000', p3: '15.0000' },
  });
  assert.deepEqual(normalizeFormula({ costFactor: '999999.999999', margins: { p1: '99999.9999', p2: 0, p3: '0' } }), {
    costFactor: '999999.999999', margins: { p1: '99999.9999', p2: '0.0000', p3: '0.0000' },
  });
  assert.deepEqual(normalizeFormula({ costFactor: '1.1092', margins: { p1: '15', p2: '13', p3: '0' } }), {
    costFactor: '1.109200', margins: { p1: '15.0000', p2: '13.0000', p3: '0.0000' },
  });
});

test('rejects invalid decimal signs, blanks, exponents, bounds and scale', () => {
  assert.throws(()=>normalizeFormula({costFactor:'',margins:{p1:0,p2:0,p3:0}}));
  for (const costFactor of [0, '1000000', '1.0000001']) {
    assert.throws(() => normalizeFormula({ ...f, costFactor }), /factor de costo/);
  }
  for (const p1 of ['100000', 0.00001, '', '1\n', '+1', '1e0', -1, NaN, Infinity]) {
    assert.throws(() => normalizeFormula({ ...f, margins: { ...margins, p1 } }), /recargo P1/);
  }
  for (const cost of ['1000000000000.00', '999999999999.9901', '1.00001', '', ' ', '1.00\n', '+1', '1e3', -1, NaN, Infinity, null]) {
    assert.throws(() => calculateFormula(cost, f, 0), /costo/);
  }
});

test('uses half-up cents and applies ceiling directly to the unrounded rational', () => {
  assert.deepEqual(calculateFormula('1000',f,5),{
    adjustedCost:'1180.00',prices:{p1:'1595.00',p2:'1475.00',p3:'1360.00'}});
  assert.equal(calculateFormula('1.00', {costFactor:1,margins:{p1:0.0001,p2:0,p3:0}},1).prices.p1,'2.00');
  assert.equal(calculateFormula('0.01',{costFactor:'0.5',margins:{p1:0,p2:0,p3:0}},0).adjustedCost,'0.01');
  assert.deepEqual(calculateFormula('2.01', { costFactor: '0.5', margins }, 0), {
    adjustedCost: '1.01', prices: { p1: '1.01', p2: '1.01', p3: '1.01' },
  });
  assert.equal(calculateFormula('0.01', { costFactor: 1, margins: { ...margins, p1: 50 } }, 0).prices.p1, '0.02');
  assert.deepEqual(calculateFormula(0, f, 25), {
    adjustedCost: '0.00', prices: { p1: '0.00', p2: '0.00', p3: '0.00' },
  });
});

test('accepts only configured rounding steps and checks every monetary bound', () => {
  for (const rounding of [undefined, null, '5', -1, 2, 0.5, NaN]) {
    assert.throws(() => calculateFormula(1, f, rounding), /redondeo/);
  }
  for (const [step, expected] of [[0, '1.01'], [1, '2.00'], [5, '5.00'], [10, '10.00'], [25, '25.00']]) {
    assert.equal(calculateFormula('1.01', { costFactor: 1, margins }, step).prices.p1, expected);
  }
  assert.throws(()=>calculateFormula('999999999999.99',f,0));
  assert.equal(calculateFormula(maxCost, { costFactor: 1, margins }, 0).prices.p1, maxCost);
  assert.throws(() => calculateFormula(maxCost, { costFactor: 1, margins: { ...margins, p1: 1 } }, 0), /límite/);
  assert.throws(() => calculateFormula(maxCost, { costFactor: 1, margins }, 1), /límite/);
});

test('the Polymet adapter preserves numeric values and its defaults', () => {
  assert.equal(adjustedCost(2.01, { costFactor: 0.5 }), 1.01);
  assert.deepEqual(pricesFromFormula(100, { costFactor: 1, margins: { ...margins, p1: 10 } }, 1), {
    p1: 110, p2: 100, p3: 100,
  });
  assert.equal(adjustedCost(1000), 1000);
  assert.deepEqual(pricesFromFormula(1000, undefined, 5), { p1: 1350, p2: 1250, p3: 1150 });
});

test('cascading supplier formula matches exact owner example (P/Lista -> Costo -> P/Mayor -> Detalle)', () => {
  const ownerFormula = { costFactor: '1.12', margins: { p2: '13', p1: '15', p3: '0' } };
  assert.deepEqual(calculateCascadeFormula('100', ownerFormula, 0), {
    costExact: '112.0000',
    cost: '112',
    prices: { p2: '126.56', p1: '145.54' },
  });
  assert.deepEqual(calculateCascadeFromCost('112', ownerFormula, 0), {
    costExact: '112.0000',
    cost: '112',
    prices: { p2: '126.56', p1: '145.54' },
  });
  const discountFormula = { costFactor: '0.80', margins: { p2: '25', p1: '20', p3: '0' } };
  assert.deepEqual(calculateCascadeFormula('100', discountFormula, 0), {
    costExact: '80.0000',
    cost: '80',
    prices: { p2: '100.00', p1: '120.00' },
  });
  assert.deepEqual(calculateCascadeFormula('100', ownerFormula, 5), {
    costExact: '112.0000',
    cost: '112',
    prices: { p2: '130.00', p1: '150.00' },
  });
  const fourDecimalFormula = { costFactor: '1.1092', margins: { p2: '13', p1: '15', p3: '0' } };
  assert.deepEqual(calculateCascadeFormula('100', fourDecimalFormula, 0), {
    costExact: '110.9200',
    cost: '110.92',
    prices: { p2: '125.34', p1: '144.14' },
  });
});
