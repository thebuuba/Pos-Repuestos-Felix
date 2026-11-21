import { journalTransaction } from './operation-journal.js';

const productFields = new Set([
  'codigo', 'nombre', 'marca', 'categoria', 'ubicacion', 'stockMinimo', 'gravado',
  'stock', 'costo', 'precio1', 'precio2', 'precio3', 'version',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const changedDatabase = 'La base cambió. Revisa la solicitud y los datos antes de continuar.';
const unconfirmed = 'No se confirmó la operación. Reintenta la solicitud pendiente.';

function checkTarget(method, path) {
  if (method === 'POST' && path === '/api/productos') return;
  if (['PUT', 'DELETE'].includes(method) && /^\/api\/productos\/[1-9]\d*$/.test(path)) return;
  throw new Error('La operación de catálogo no es válida.');
}

function checkSnapshot(snapshot) {
  if (!uuid.test(snapshot?.databaseId) || !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 || typeof snapshot.databaseLabel !== 'string' ||
      !Array.isArray(snapshot.state?.productos) ||
      !snapshot.state.productos.every(product => product && Number.isSafeInteger(product.id) &&
        Number.isSafeInteger(product.version) &&
        ['codigo','nombre','marca','categoria','ubicacion'].every(key => typeof product[key] === 'string') &&
        ['costo','precio1','precio2','precio3','stock','stockMinimo'].every(key => Number.isFinite(product[key])) &&
        typeof product.gravado === 'boolean')) {
    throw new Error('El servicio devolvió datos de catálogo no válidos.');
  }
  return snapshot;
}

async function serviceError(response) {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.error === 'string' ? body.error : unconfirmed);
}

export function createPosClient() {
  let state = { snapshot: null, pending: null, busy: false, connection: 'checking', error: null, lastSync: null };
  const listeners = new Set();
  const retired = new Set();
  const changes = new BroadcastChannel('repuestos-felix-operaciones');
  let active = 0, issued = 0, latestConfirmed = 0, etag = null, disposed = false;

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

  function reload() {
    const sequence = ++issued;
    return working(async () => {
      await readPending();
      const previousTag = etag;
      const previous = state.snapshot;
      try {
        const response = await fetch('/api/state', {
          credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
          headers: previousTag ? { 'If-None-Match': previousTag } : {},
        });
        if (response.status === 304) {
          if (!previous || !previousTag) throw new Error('No hay una copia confirmada del catálogo.');
          if (previous === state.snapshot && previousTag === etag) {
            latestConfirmed = Math.max(latestConfirmed, sequence);
            set({ connection: 'connected', lastSync: new Date().toISOString() });
          }
        } else {
          if (response.status !== 200) throw await serviceError(response);
          apply(checkSnapshot(await response.json()), response.headers.get('ETag'), sequence);
        }
        return state.snapshot;
      } catch (error) {
        if (sequence === issued) set({ connection: 'unavailable' });
        if (error instanceof TypeError) throw new Error('No se pudo conectar con el servicio.');
        throw error;
      }
    });
  }

  function checkGeneration(databaseId) {
    if (!state.snapshot) throw new Error('Actualiza el catálogo antes de guardar.');
    if (databaseId !== state.snapshot.databaseId) throw new Error(changedDatabase);
  }

  async function send(packet) {
    checkTarget(packet.method, packet.path);
    checkGeneration(packet.databaseId);
    // A crashed tab releases its lock. Its durable "sending" marker still
    // records that the previous attempt could have committed.
    return navigator.locks.request('repuestos-felix-envio-' + packet.id, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('Otra pestaña está enviando esta solicitud.');
      let firstAttempt;
      const sending = await updatePending(current => {
        if (current?.id !== packet.id) throw new Error('La solicitud pendiente cambió. Actualiza los datos.');
        checkGeneration(current.databaseId);
        firstAttempt = current.status === 'prepared';
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
          const error = await serviceError(received);
          const generationConflict = /la base (cambió|fue restaurada)/i.test(error.message);
          definitive = firstAttempt && received.status >= 400 && received.status < 500 &&
            received.status !== 408 && !generationConflict && sending.databaseId === state.snapshot?.databaseId;
          throw error;
        }
        const snapshot = checkSnapshot(await received.json());
        if (!Number.isSafeInteger(snapshot.result?.id) || snapshot.result.id < 1) throw new Error(unconfirmed);
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
          await updatePending(current => current?.id === sending.id ? null : current);
          if (received.status === 409) await reload().catch(() => {});
          throw cause;
        }
        if (received?.status === 409) await reload().catch(() => {});
        const error = new Error(cause instanceof TypeError || cause instanceof SyntaxError ? unconfirmed : cause.message);
        error.uncertain = true;
        throw error;
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
