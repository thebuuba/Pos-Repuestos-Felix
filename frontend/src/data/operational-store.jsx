import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PosStoreContext } from './pos-context.jsx';

function productFromSnapshot(p, databaseId) {
  return {
    id: p.id, version: p.version, databaseId, code: p.codigo, name: p.nombre,
    brand: p.marca, category: p.categoria, location: p.ubicacion, minStock: p.stockMinimo,
    taxable: p.gravado, cost: p.costo, stock: p.stock,
    prices: { p1: p.precio1, p2: p.precio2, p3: p.precio3 },
  };
}

const formulas = [];
const settings = {};

function productOperation(p, remove) {
  if (remove) return { method: 'DELETE', path: '/api/productos/' + p.id, payload: { version: p.version }, databaseId: p.databaseId };
  const editing = Number.isSafeInteger(p.id);
  const payload = {
    codigo: p.code, nombre: p.name, marca: p.brand, categoria: p.category, ubicacion: p.location,
    stockMinimo: p.minStock, gravado: p.taxable, costo: p.cost, stock: p.stock,
    precio1: p.prices.p1, precio2: p.prices.p2, precio3: p.prices.p3,
    ...(editing ? { version: p.version } : {}),
  };
  return { method: editing ? 'PUT' : 'POST', path: editing ? '/api/productos/' + p.id : '/api/productos', payload, databaseId: p.databaseId };
}

export function OperationalStoreProvider({ client, children }) {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const [dialogRetries] = useState(() => ({ save: new WeakMap(), remove: new WeakMap() }));
  useEffect(() => {
    const reload = () => { client.reload().catch(() => {}); };
    const refreshVisible = () => { if (!document.hidden) reload(); };
    reload();
    const timer = window.setInterval(refreshVisible, 5_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('online', reload);
    window.addEventListener('offline', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('online', reload);
      window.removeEventListener('offline', reload);
    };
  }, [client]);
  const { snapshot } = state;
  const products = useMemo(() => snapshot?.state.productos.map(p => productFromSnapshot(p, snapshot.databaseId)) ?? [], [snapshot]);
  const runtime = {
    ...state, mode: 'online', databaseId: snapshot?.databaseId ?? null, revision: snapshot?.revision ?? null,
    reload: client.reload, retryPending: client.retryPending,
  };

  async function writeProduct(p, remove = false) {
    const retries = remove ? dialogRetries.remove : dialogRetries.save;
    const retry = retries.get(p);
    try {
      const result = await (retry ? retry() : client.writeOperation(productOperation(p, remove)));
      retries.delete(p);
      return result;
    } catch (error) {
      if (error.definitive) retries.delete(p);
      else if (error.retry) retries.set(p, error.retry);
      throw error;
    }
  }

  return <PosStoreContext.Provider value={{ runtime, products, formulas, settings,
    saveProduct: p => writeProduct(p), deleteProduct: p => writeProduct(p, true) }}>
    {children}
  </PosStoreContext.Provider>;
}
