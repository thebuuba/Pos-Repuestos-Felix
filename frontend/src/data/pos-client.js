import { journalTransaction } from './operation-journal.js';

const productFields = new Set([
  'codigo', 'nombre', 'marca', 'categoria', 'ubicacion', 'stockMinimo', 'gravado',
  'stock', 'costo', 'precio1', 'precio2', 'precio3', 'version',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const changedDatabase = 'La base cambió. Revisa la solicitud y los datos antes de continuar.';
const unconfirmed = 'No se confirmó la operación. Reintenta la solicitud pendiente.';

function sameVersionTag(first, second) {
  // Conditional GET uses the opaque tag, even if an intermediary changes W/.
  const opaque = value => typeof value === 'string' ? /^(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*")$/.exec(value)?.[1] : undefined;
  const tag = opaque(first);
  return tag !== undefined && tag === opaque(second);
}

function checkTarget(method, path) {
  if (method === 'POST' && path === '/api/productos') return;
  if (['PUT', 'DELETE'].includes(method) && /^\/api\/productos\/[1-9]\d*$/.test(path)) return;
  throw new Error('La operación de catálogo no es válida.');
}

function validProduct(p) {
  return p && Number.isSafeInteger(p.id) && p.id > 0 && Number.isSafeInteger(p.version) && p.version > 0 &&
    ['codigo', 'nombre', 'marca', 'categoria', 'ubicacion'].every(key => typeof p[key] === 'string' && p[key].length <= 2000) &&
    p.codigo.trim() && p.nombre.trim() &&
    ['stock', 'stockMinimo'].every(key => Number.isInteger(p[key]) && p[key] >= 0 && p[key] <= 2147483647) &&
    (!Object.hasOwn(p, 'stock_minimo') || p.stock_minimo === p.stockMinimo) &&
    ['costo', 'precio1', 'precio2', 'precio3'].every(key => typeof p[key] === 'number' && /^\d{1,12}(?:\.\d{1,2})?$/.test(String(p[key]))) &&
    typeof p.gravado === 'boolean' && p.activo === true;
}

function checkSnapshot(snapshot) {
  const products = snapshot?.state?.productos;
  if (typeof snapshot?.databaseId !== 'string' || !uuid.test(snapshot.databaseId) || !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 || typeof snapshot.databaseLabel !== 'string' ||
      !Array.isArray(products) || !products.every(validProduct) ||
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

function matchesRejection(proof, packet) {
  return proof?.operationId === packet.id && proof.databaseId === packet.databaseId &&
    proof.method === packet.method && proof.path === packet.path;
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
    checkTarget(packet.method, packet.path);
    checkGeneration(packet.databaseId);
    // A crashed tab releases its lock. Its durable "sending" marker still
    // records that the previous attempt could have committed.
    return navigator.locks.request('repuestos-felix-envio-' + packet.id, { ifAvailable: true }, async lock => {
      if (!lock) throw uncertainError(new Error('Otra pestaña está enviando esta solicitud.'), packet);
      const sending = await updatePending(current => {
        checkGeneration(packet.databaseId);
        if (!current && exactRetry) return packet;
        if (current?.id !== packet.id || current.databaseId !== packet.databaseId ||
            current.method !== packet.method || current.path !== packet.path || current.body !== packet.body) {
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
          const proven = [400, 409].includes(received.status) && matchesRejection(body?.rejection, sending);
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
        const target = snapshot.result?.id;
        if (!Number.isSafeInteger(target) || target < 1 ||
            (sending.method !== 'POST' && sending.path !== '/api/productos/' + target)) throw new Error(unconfirmed);
        if (snapshot.databaseId !== sending.databaseId) throw new Error(changedDatabase);
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
      checkTarget(method, path);
      checkGeneration(databaseId);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.entries(payload).some(([key, value]) => !productFields.has(key) ||
            !['boolean','number','string'].includes(typeof value))) {
        throw new Error('Los campos de la solicitud no son válidos.');
      }
      const body = JSON.stringify({ ...payload, databaseId });
      const packet = await updatePending(current => {
        if (!current) return { id: crypto.randomUUID(), method, path, body, databaseId, status: 'prepared' };
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
