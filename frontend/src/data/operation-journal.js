// All tabs on this origin share one slot. The read and conditional update must
// remain inside the same IndexedDB transaction.
export async function journalTransaction(update) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('repuestos-felix-operaciones', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operaciones');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = update
        ? database.transaction('operaciones', 'readwrite', { durability: 'strict' })
        : database.transaction('operaciones', 'readonly');
      const store = transaction.objectStore('operaciones');
      const read = store.get('pendiente');
      let result, cause;
      read.onsuccess = () => {
        try {
          const current = read.result ?? null;
          result = update ? update(current) : current;
          if (result === current) return;
          if (result) store.put(result, 'pendiente');
          else store.delete('pendiente');
        } catch (error) {
          cause = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(cause || new Error('No se pudo guardar el registro local de la solicitud.'));
    });
  } finally {
    database.close();
  }
}
