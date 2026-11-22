// All tabs on this origin share one slot. The read and conditional update must
// remain inside the same IndexedDB transaction.
async function transact(write, run) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('repuestos-felix-operaciones', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operaciones');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = write
        ? database.transaction('operaciones', 'readwrite', { durability: 'strict' })
        : database.transaction('operaciones', 'readonly');
      const store = transaction.objectStore('operaciones');
      let result, cause;
      const guard = action => () => {
        try { action(); } catch (error) {
          cause = error;
          transaction.abort();
        }
      };
      guard(() => run(store, value => { result = value; }, guard))();
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(cause || new Error('No se pudo guardar el registro local de la solicitud.'));
    });
  } finally {
    database.close();
  }
}

export function journalTransaction(update) {
  return transact(!!update, (store, result, guard) => {
    const read = store.get('pendiente');
    read.onsuccess = guard(() => {
      const current = read.result ?? null;
      const next = update ? update(current) : current;
      result(next);
      if (next === current) return;
      if (!next) { store.delete('pendiente'); return; }
      // The archived packet is also a tombstone. An old tab's exact retry must
      // never put it back in the active slot, even with its old cached catalog.
      const archived = store.get('archivo:' + next.id);
      archived.onsuccess = guard(() => {
        if (archived.result) throw new Error('La solicitud fue archivada. Revisa el historial antes de continuar.');
        store.put(next, 'pendiente');
      });
    });
  });
}

export function archiveJournal(review) {
  return transact(true, (store, result, guard) => {
    const read = store.get('pendiente');
    read.onsuccess = guard(() => {
      const record = review(read.result ?? null);
      store.add(record, 'archivo:' + record.packet.id);
      store.delete('pendiente');
      result(record);
    });
  });
}

export function journalArchives(countOnly = false) {
  return transact(false, (store, result, guard) => {
    const range = IDBKeyRange.bound('archivo:', 'archivo:\uffff');
    const read = countOnly ? store.count(range) : store.getAll(range);
    read.onsuccess = guard(() => result(read.result));
  });
}
