import { createRoot } from 'react-dom/client';
import { lazy } from 'react';
import './src/styles/fonts.css';
import './src/styles/theme.css';
import './src/styles/standards.css';
import { PosShell } from './src/pos-shell.jsx';
import { OperationalPointOfSalePage } from './src/pages/point-of-sale-page.jsx';
import { OperationalStoreProvider } from './src/data/operational-store.jsx';
import { createPosClient } from './src/data/pos-client.js';

const client = createPosClient();
const modules = {
  '/': () => import('./src/pages/dashboard-page.jsx').then(m => ({ default: m.DashboardPage })),
  '/inventario': () => import('./src/pages/inventory-page.jsx').then(m => ({ default: m.InventoryPage })),
  '/compras': () => import('./src/pages/purchases-page.jsx').then(m => ({ default: m.PurchasesPage })),
  '/clientes': () => import('./src/pages/customers-page.jsx').then(m => ({ default: m.CustomersPage })),
  '/suplidores': () => import('./src/pages/suppliers-page.jsx').then(m => ({ default: m.SuppliersPage })),
  '/configuracion': () => import('./src/pages/settings-page.jsx').then(m => ({ default: m.SettingsPage })),
  '/reportes': () => import('./src/pages/reports-page.jsx').then(m => ({ default: m.ReportsPage })),
  '/ayuda': () => import('./src/pages/help-page.jsx').then(m => ({ default: m.HelpPage })),
  '/caja': () => import('./src/pages/cash-register-page.jsx').then(m => ({ default: m.CashRegisterPage })),
  '/cuentas-por-cobrar': () => import('./src/pages/receivables-page.jsx').then(m => ({ default: m.ReceivablesPage })),
  '/cuentas-por-pagar': () => import('./src/pages/payables-page.jsx').then(m => ({ default: m.PayablesPage })),
  '/recordatorios': () => import('./src/pages/reminders-page.jsx').then(m => ({ default: m.RemindersPage })),
};
const pages = Object.fromEntries(Object.entries(modules).map(([path, load]) => [path, lazy(load)]));
pages['/ventas'] = OperationalPointOfSalePage;
// Fetch the current module and initial state in parallel with React's first render.
modules[location.pathname]?.().catch(() => {});
client.reload({ recover: true, resumeRecovery: true }).catch(() => {});
createRoot(document.getElementById('root')).render(
  <OperationalStoreProvider client={client}>
    <PosShell pages={pages} />
  </OperationalStoreProvider>
);
