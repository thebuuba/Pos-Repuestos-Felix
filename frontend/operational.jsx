import { createRoot } from 'react-dom/client';
import './fonts.css';
import './src/polymet.css';
import './standards.css';
import { PosShell } from './src/pos-shell.jsx';
import { InventoryPage } from './src/polymet/pages/inventory-page.jsx';
import { DashboardPage } from './src/polymet/pages/dashboard-page.jsx';
import { OperationalPointOfSalePage } from './src/polymet/pages/point-of-sale-page.jsx';
import { PurchasesPage } from './src/polymet/pages/purchases-page.jsx';
import { CustomersPage } from './src/polymet/pages/customers-page.jsx';
import { SuppliersPage } from './src/polymet/pages/suppliers-page.jsx';
import { SettingsPage } from './src/polymet/pages/settings-page.jsx';
import { ReportsPage } from './src/polymet/pages/reports-page.jsx';
import { HelpPage } from './src/polymet/pages/help-page.jsx';
import { CashRegisterPage } from './src/polymet/pages/cash-register-page.jsx';
import { ReceivablesPage } from './src/polymet/pages/receivables-page.jsx';
import { PayablesPage } from './src/polymet/pages/payables-page.jsx';
import { OperationalStoreProvider } from './src/data/operational-store.jsx';
import { createPosClient } from './src/data/pos-client.js';

const client = createPosClient();
createRoot(document.getElementById('root')).render(
  <OperationalStoreProvider client={client}>
    <PosShell pages={{ '/': DashboardPage, '/inventario': InventoryPage, '/ventas': OperationalPointOfSalePage,
      '/compras': PurchasesPage, '/clientes': CustomersPage, '/suplidores': SuppliersPage, '/configuracion': SettingsPage,
      '/reportes': ReportsPage, '/ayuda': HelpPage, '/caja': CashRegisterPage,
      '/cuentas-por-cobrar': ReceivablesPage, '/cuentas-por-pagar': PayablesPage }} />
  </OperationalStoreProvider>
);
