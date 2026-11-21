export const initialState = {
  empresa: 'REPUESTOS FELIX', itbisRate: 0.18,
  productos: [
    { codigo: 'BUJ-01', nombre: 'Bujía NGK C7HSA', costo: 100, stock: 50, precio1: 150, precio2: 135, precio3: 120 },
    { codigo: 'BUJ-02', nombre: 'Bujía NGK C5HSA', costo: 100, stock: 50, precio1: 150, precio2: 135, precio3: 120 },
  ],
  clientes: [{ nombre: 'Cliente Contado', rnc: '000000000', tel: '', deuda: 0 }],
  suplidores: [
    { nombre: 'Super Gato', rnc: '', tel: '' },
    { nombre: 'Almonte & Asociados', rnc: '', tel: '' },
    { nombre: 'Importadora Masotti', rnc: '', tel: '' },
    { nombre: 'Arias', rnc: '101038561', tel: '809-412-4737' },
  ],
  facturas: [], compras: [],
};
