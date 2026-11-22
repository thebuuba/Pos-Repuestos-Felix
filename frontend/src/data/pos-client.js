import { normalizeFormula } from '../../../src/domain/pricing.js';
import { journalTransaction } from './operation-journal.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const changedDatabase = 'La base cambió. Revisa la solicitud y los datos antes de continuar.';
const unconfirmed = 'No se confirmó la operación. Reintenta la solicitud pendiente.';

function sameVersionTag(first, second) {
  // Conditional GET uses the opaque tag, even if an intermediary changes W/.
  const opaque = value => typeof value === 'string' ? /^(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*")$/.exec(value)?.[1] : undefined;
  const tag = opaque(first);
  return tag !== undefined && tag === opaque(second);
}

const id = value => Number.isSafeInteger(value) && value > 0;
const quantity = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const text = value => typeof value === 'string' && value.length <= 2000;
const name = value => text(value) && value.trim().length > 0;
const nullable = check => value => value === null || check(value);
const oneOf = (...values) => value => values.includes(value);
const money = value => typeof value === 'number' && /^\d{1,12}(?:\.\d{1,2})?$/.test(String(value));
const decimal = pattern => value => (typeof value === 'string' || Number.isFinite(value)) && pattern.test(String(value));
const rate = decimal(/^\d{1,3}(?:\.\d{1,4})?$/);
const percentage = value => rate(value) && Number(value) <= 100;
const string = value => typeof value === 'string';
const amount = decimal(/^\d{1,12}(?:\.\d{1,2})?$/);
const productFields = { codigo: string, nombre: string, marca: string, categoria: string, ubicacion: string,
  stockMinimo: quantity, gravado: value => typeof value === 'boolean', stock: quantity,
  costo: amount, precio1: amount, precio2: amount, precio3: amount };
const contactFields = { nombre: name, rnc: text, tel: text, correo: text };
const customerFields = { ...contactFields, direccion: text, limiteCredito: nullable(amount) };
const supplierFields = { ...contactFields, contacto: text, diasCredito: nullable(quantity), formulaId: nullable(id) };
const formulaValue = value => typeof value === 'string' || Number.isFinite(value);
const formulaFields = { nombre: name, factorCosto: formulaValue, recargo1: formulaValue, recargo2: formulaValue, recargo3: formulaValue };
function validFormula(row) {
  try {
    normalizeFormula({ costFactor: row.factorCosto, margins: { p1: row.recargo1, p2: row.recargo2, p3: row.recargo3 } });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
const settingsFields = { empresa: name, rnc: text, tel: text, correo: text, direccion: text, itbisPorcentaje: percentage,
  redondeo: oneOf(0, 1, 5, 10, 25), nivelPrecioPredeterminado: oneOf(null, 'p1', 'p2', 'p3'),
  formatoImpresion: oneOf(null, 'Térmica 80 mm', 'Térmica 58 mm', 'Carta (8.5 x 11)'), pieTicket: text,
  permitirStockNegativo: oneOf(false) };
const resourceFields = { productos: productFields, clientes: customerFields, suplidores: supplierFields, formulas: formulaFields,
  configuracion: settingsFields };

function checkTarget(method, path) {
  if (method === 'PUT' && path === '/api/configuracion') return { resource: 'configuracion', target: 1 };
  const match = typeof path === 'string' && /^\/api\/(productos|clientes|suplidores|formulas)(?:\/([1-9]\d*))?$/.exec(path);
  if (match && (match[2] ? ['PUT', 'DELETE'].includes(method) && id(Number(match[2])) : method === 'POST')) {
    return { resource: match[1], target: match[2] ? Number(match[2]) : null };
  }
  throw new Error('La operación de catálogo no es válida.');
}

function checkPayload(method, resource, payload) {
  const mutable = resourceFields[resource];
  const invalid = () => { throw new Error('Los campos de la solicitud no son válidos.'); };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid();
  if (method !== 'POST' && !id(payload.version)) invalid();
  const entries = Object.entries(payload);
  if (resource === 'configuracion' && entries.length < 2) invalid();
  if (method !== 'DELETE') {
    if (['clientes', 'suplidores', 'formulas'].includes(resource) && !name(payload.nombre)) invalid();
    if (resource === 'formulas' && !validFormula(payload)) invalid();
  }
  for (const [key, value] of entries) {
    if (key === 'version' && method !== 'POST') continue;
    if (method === 'DELETE' || !Object.hasOwn(mutable, key)) invalid();
    const legacyEmpty = method === 'POST' && ['clientes', 'suplidores'].includes(resource) && ['rnc', 'tel'].includes(key) && value === null;
    if (!legacyEmpty && !mutable[key](value)) invalid();
  }
}

function validProduct(p) {
  return p && id(p.id) && id(p.version) && name(p.codigo) && name(p.nombre) &&
    ['marca', 'categoria', 'ubicacion'].every(key => text(p[key])) &&
    quantity(p.stock) && quantity(p.stockMinimo) &&
    (!Object.hasOwn(p, 'stock_minimo') || p.stock_minimo === p.stockMinimo) &&
    ['costo', 'precio1', 'precio2', 'precio3'].every(key => money(p[key])) &&
    typeof p.gravado === 'boolean' && p.activo === true;
}

function complete(row, fields) {
  return row && Object.entries(fields).every(([key, validate]) => validate(row[key]));
}
function records(rows, validate) {
  return Array.isArray(rows) && rows.every(row => row && id(row.id) && validate(row)) &&
    new Set(rows.map(row => row.id)).size === rows.length;
}
function documentDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const lineFields = { productoId: id, codigo: name, nombre: name, cant: value => quantity(value) && value > 0, subtotal: money };
function validDocument(row, sale) {
  const header = sale ? { clienteId: id, cliente: name, clienteRnc: text, ncf: nullable(name),
    tipoComprobante: oneOf('B01','B02','B14'), condicion: oneOf('Credito','Contado'), base: money, itbis: money }
    : { suplidorId: id, suplidor: name, numero: name };
  const amounts = sale ? { precio: money, base: money, itbis: money } : { costo: money, p1: money, p2: money, p3: money };
  return complete(row, header) && documentDate(row.fechaISO) && money(row.total) && row.items?.length > 0 &&
    records(row.items, line => complete(line, lineFields) && complete(line, amounts));
}
function validOperationalState(state) {
  const config = state.configuracion;
  if (!complete(config, settingsFields) || !id(config.version) || typeof config.itbisPorcentaje !== 'number' ||
      state.empresa !== config.empresa || state.configuracionVersion !== config.version || !Number.isFinite(state.itbisRate) ||
      Number((config.itbisPorcentaje / 100).toFixed(6)) !== state.itbisRate) return false;
  if (!records(state.formulas, row => id(row.version) && name(row.nombre) && validFormula(row) &&
      ['factorCosto','recargo1','recargo2','recargo3'].every(key => typeof row[key] === 'number'))) return false;
  const formulas = new Set(state.formulas.map(row => row.id));
  return Array.isArray(state.movimientos) && records(state.clientes, row => id(row.version) && complete(row, customerFields) && nullable(money)(row.limiteCredito) &&
      typeof row.esContado === 'boolean' && Number.isFinite(row.deuda) && /^-?\d+(?:\.\d{1,2})?$/.test(String(row.deuda))) &&
    state.clientes.filter(row => row.esContado).length <= 1 &&
    records(state.suplidores, row => id(row.version) && complete(row, supplierFields) && (row.formulaId === null || formulas.has(row.formulaId))) &&
    records(state.facturas, row => validDocument(row, true)) && records(state.compras, row => validDocument(row, false));
}

function checkSnapshot(snapshot) {
  const products = snapshot?.state?.productos;
  if (typeof snapshot?.databaseId !== 'string' || !uuid.test(snapshot.databaseId) || !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 || typeof snapshot.databaseLabel !== 'string' ||
      !Array.isArray(products) || !products.every(validProduct) || !validOperationalState(snapshot.state) ||
      new Set(products.map(p => p.id)).size !== products.length ||
      // PostgreSQL's case folding for non-ASCII SKU characters depends on its collation.
      new Set(products.map(p => p.codigo.replace(/[A-Z]/g, letter => letter.toLowerCase()))).size !== products.length) {
    throw new Error('El servicio devolvió datos de catálogo no válidos.');
  }
  return snapshot;
}

async function serviceError(response) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' && body.error.trim() ? body : null;
}

function matchesPacket(proof, packet) {
  return proof?.operationId === packet.id && proof.databaseId === packet.databaseId &&
    proof.method === packet.method && proof.path === packet.path;
}

function checkConfirmation(snapshot, packet, resource, expected, payload) {
  const proof = snapshot.confirmation;
  const target = snapshot.result?.id;
  if (!matchesPacket(proof, packet) || typeof proof.replayed !== 'boolean' ||
      !id(target) || (expected !== null && target !== expected)) throw new Error(unconfirmed);

  // Older journals have no baseline. Their exact operation can still be confirmed by the server.
  if (Object.hasOwn(packet, 'baseRevision') && (!Number.isSafeInteger(packet.baseRevision) ||
      packet.baseRevision < 0 || snapshot.revision <= packet.baseRevision)) throw new Error(unconfirmed);
  // The current snapshot on a replay can reflect subsequent edits and deactivations.
  if (proof.replayed) return;
  const row = resource === 'configuracion' ? snapshot.state.configuracion : snapshot.state[resource].find(item => item.id === target);
  if (packet.method === 'DELETE') {
    if (row) throw new Error(unconfirmed);
  } else if (row?.version !== (packet.method === 'POST' ? 1 : payload.version + 1)) throw new Error(unconfirmed);
}

export function createPosClient() {
  let state = { snapshot: null, pending: null, busy: false, connection: 'checking', error: null, lastSync: null };
  const listeners = new Set();
  const retired = new Set();
  const changes = new BroadcastChannel('repuestos-felix-operaciones');
  let active = 0, issued = 0, latestConfirmed = 0, etag = null, disposed = false;
  let reading = null;

  function set(fields) {
    if (disposed) return;
    state = { ...state, ...fields };
    listeners.forEach(listener => listener());
  }

  async function readPending() {
    const pending = await journalTransaction();
    set({ pending });
    return pending;
  }
  changes.onmessage = () => { readPending().catch(error => set({ error: error.message })); };

  async function updatePending(update) {
    const pending = await journalTransaction(update);
    set({ pending });
    if (!disposed) changes.postMessage(null);
    return pending;
  }

  function apply(snapshot, tag, request) {
    const current = state.snapshot;
    if (current?.databaseId === snapshot.databaseId) {
      if (snapshot.revision < current.revision) return;
    } else {
      if (retired.has(snapshot.databaseId) || request < latestConfirmed) return;
      if (current) retired.add(current.databaseId);
    }
    latestConfirmed = Math.max(latestConfirmed, request);
    etag = tag;
    set({ snapshot, connection: 'connected', lastSync: new Date().toISOString() });
  }

  async function working(work) {
    if (disposed) throw new Error('El cliente está cerrado.');
    active++;
    set({ busy: true, error: null });
    try { return await work(); }
    catch (error) {
      set({ error: error.message });
      throw error;
    } finally {
      active--;
      set({ busy: active > 0 });
    }
  }

  function readSnapshot({ fresh = false } = {}) {
    if (reading && !fresh) return reading;
    const sequence = ++issued;
    const job = working(async () => {
      await readPending();
      const previousTag = etag;
      const previous = state.snapshot;
      try {
        const response = await fetch('/api/state', {
          credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
          headers: previousTag ? { 'If-None-Match': previousTag } : {},
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 304) {
          if (!previous || !previousTag) throw new Error('No hay una copia confirmada del catálogo.');
          if (!sameVersionTag(response.headers.get('ETag'), previousTag)) throw new Error('El servicio no confirmó la versión del catálogo.');
          if (previous === state.snapshot && previousTag === etag) {
            latestConfirmed = Math.max(latestConfirmed, sequence);
            set({ connection: 'connected', lastSync: new Date().toISOString() });
          }
          return previous;
        }
        if (response.status !== 200) throw new Error((await serviceError(response))?.error || 'El servicio no confirmó la lectura del catálogo.');
        const observed = checkSnapshot(await response.json());
        apply(observed, response.headers.get('ETag'), sequence);
        return observed;
      } catch (error) {
        if (sequence === issued) set({ connection: 'unavailable' });
        if (error instanceof TypeError || error.name === 'TimeoutError') throw new Error('No se pudo conectar con el servicio.');
        throw error;
      }
    }).finally(() => { if (reading === job) reading = null; });
    reading = job;
    return job;
  }

  async function reload(options) {
    await readSnapshot(options);
    return state.snapshot;
  }

  function checkGeneration(databaseId) {
    if (!state.snapshot) throw new Error('Actualiza el catálogo antes de guardar.');
    if (databaseId !== state.snapshot.databaseId) throw new Error(changedDatabase);
  }

  function uncertainError(cause, packet) {
    // The dialog may outlive the journal slot if another tab confirms it.
    const original = Object.freeze({ ...packet, status: 'sending' });
    const error = new Error(cause instanceof TypeError || cause instanceof SyntaxError ? unconfirmed : cause.message);
    error.uncertain = true;
    error.operationId = original.id;
    error.retry = () => working(() => send(original, true));
    return error;
  }

  async function send(packet, exactRetry = false) {
    const { resource, target: expected } = checkTarget(packet.method, packet.path);
    const { databaseId, ...payload } = JSON.parse(packet.body);
    if (packet.databaseId !== databaseId || !uuid.test(packet.id)) throw new Error(unconfirmed);
    checkPayload(packet.method, resource, payload);
    checkGeneration(packet.databaseId);
    // A crashed tab releases its lock. Its durable "sending" marker still
    // records that the previous attempt could have committed.
    return navigator.locks.request('repuestos-felix-envio-' + packet.id, { ifAvailable: true }, async lock => {
      if (!lock) throw uncertainError(new Error('Otra pestaña está enviando esta solicitud.'), packet);
      const sending = await updatePending(current => {
        checkGeneration(packet.databaseId);
        if (!current && exactRetry) return packet;
        if (current?.id !== packet.id || current.databaseId !== packet.databaseId ||
            current.method !== packet.method || current.path !== packet.path || current.body !== packet.body || current.baseRevision !== packet.baseRevision) {
          throw uncertainError(new Error('La solicitud pendiente cambió. Revisa las operaciones antes de reintentar.'), packet);
        }
        return { ...current, status: 'sending' };
      });
      const request = ++issued;
      let received;
      let definitive = false;
      try {
        checkGeneration(sending.databaseId);
        received = await fetch(sending.path, {
          method: sending.method, mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sending.id },
          body: sending.body,
        });
        if (received.status !== 200) {
          const body = await serviceError(received);
          const proven = [400, 409].includes(received.status) && matchesPacket(body?.rejection, sending);
          // Even an unproven conflict may announce a restored generation.
          if (proven || received.status === 409) {
            const observed = await readSnapshot({ fresh: true }).catch(() => null);
            if (proven && observed?.databaseId === sending.databaseId) {
              await updatePending(current => {
                checkGeneration(sending.databaseId);
                return current?.id === sending.id ? null : current;
              });
              definitive = true;
            }
          }
          throw new Error(body?.error || unconfirmed);
        }
        const snapshot = checkSnapshot(await received.json());
        if (snapshot.databaseId !== sending.databaseId) throw new Error(changedDatabase);
        checkConfirmation(snapshot, sending, resource, expected, payload);
        checkGeneration(sending.databaseId);
        apply(snapshot, null, request);
        await updatePending(current => current?.id === sending.id ? null : current);
        return snapshot;
      } catch (cause) {
        if ((!received || received.status >= 500 || [401, 403].includes(received.status)) && request >= latestConfirmed) {
          set({ connection: 'unavailable' });
        }
        if (definitive) {
          cause.definitive = true;
          throw cause;
        }
        throw uncertainError(cause, sending);
      }
    });
  }

  function writeOperation({ method, path, payload, databaseId }) {
    return working(async () => {
      const { resource } = checkTarget(method, path);
      checkGeneration(databaseId);
      checkPayload(method, resource, payload);
      const body = JSON.stringify({ ...payload, databaseId });
      const packet = await updatePending(current => {
        checkGeneration(databaseId);
        if (!current) return { id: crypto.randomUUID(), method, path, body, databaseId, baseRevision: state.snapshot.revision, status: 'prepared' };
        if (current.method === method && current.path === path && current.databaseId === databaseId && current.body === body) return current;
        throw new Error('Resuelve la solicitud pendiente antes de guardar otra operación.');
      });
      return send(packet);
    });
  }

  function retryPending() {
    return working(async () => {
      const packet = await readPending();
      if (packet) return send(packet);
    });
  }

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reload, writeOperation, retryPending,
    dispose() { disposed = true; changes.close(); listeners.clear(); },
  };
}
