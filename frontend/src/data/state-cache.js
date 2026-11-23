// Caché local de último snapshot confirmado y su ETag para reabrir la PWA con 304 Not Modified (0 bytes).
// Nunca se muestra sin confirmación previa del servidor (304 o 200) y se limpia al cerrar sesión o recibir 401.
const DB_NAME = 'repuestos-felix-cache';
const STORE_NAME = 'estado';
const CACHE_KEY = 'ultimo';

let pendingWrite = null;
let writeTimer = null;

function openCache() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readCachedSnapshot() {
  const db = await openCache();
  if (!db) return null;
  try {
    return await new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
      req.onsuccess = () => {
        const entry = req.result;
        resolve(entry && typeof entry.etag === 'string' && entry.snapshot?.state ? entry : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function flushWrite() {
  const entry = pendingWrite;
  pendingWrite = null;
  if (!entry) return;
  const db = await openCache();
  if (!db) return;
  try {
    await new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(entry, CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* Caché opcional. */ } finally {
    db.close();
  }
}

export function writeCachedSnapshot(snapshot, etag) {
  if (!snapshot?.state || typeof etag !== 'string' || !etag) return;
  pendingWrite = { snapshot, etag, savedAt: Date.now() };
  if (writeTimer !== null) clearTimeout(writeTimer);
  // Diferir la escritura para no competir con el render inmediato tras abrir o facturar.
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushWrite().catch(() => {});
  }, 150);
}

export async function clearCachedSnapshot() {
  pendingWrite = null;
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const db = await openCache();
  if (!db) return;
  try {
    await new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* Caché opcional. */ } finally {
    db.close();
  }
}
