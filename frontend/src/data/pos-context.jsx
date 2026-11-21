import { createContext, useContext } from 'react';

export const PosStoreContext = createContext(null);

export function usePosStore() {
  const store = useContext(PosStoreContext);
  if (!store) throw new Error('Falta el proveedor de datos del POS.');
  return store;
}
