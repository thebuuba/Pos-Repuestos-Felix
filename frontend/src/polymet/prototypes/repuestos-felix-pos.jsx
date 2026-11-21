// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { PosStoreProvider } from "../data/pos-store.jsx";
import { DashboardPage } from "../pages/dashboard-page.jsx";
import { PointOfSalePage } from "../pages/point-of-sale-page.jsx";
import { InventoryPage } from "../pages/inventory-page.jsx";
import { PurchasesPage } from "../pages/purchases-page.jsx";
import { CashRegisterPage } from "../pages/cash-register-page.jsx";
import { CustomersPage } from "../pages/customers-page.jsx";
import { SuppliersPage } from "../pages/suppliers-page.jsx";
import { ReportsPage } from "../pages/reports-page.jsx";
import { ReceivablesPage } from "../pages/receivables-page.jsx";
import { PayablesPage } from "../pages/payables-page.jsx";
import { SettingsPage } from "../pages/settings-page.jsx";
import { HelpPage } from "../pages/help-page.jsx";
import { PosShell } from "../../pos-shell.jsx";

const pages = {
  "/": DashboardPage,
  "/ventas": PointOfSalePage,
  "/inventario": InventoryPage,
  "/compras": PurchasesPage,
  "/caja": CashRegisterPage,
  "/clientes": CustomersPage,
  "/suplidores": SuppliersPage,
  "/reportes": ReportsPage,
  "/cuentas-por-cobrar": ReceivablesPage,
  "/cuentas-por-pagar": PayablesPage,
  "/configuracion": SettingsPage,
  "/ayuda": HelpPage,
};

export function RepuestosFelixPos() {
  return <PosStoreProvider><PosShell pages={pages} /></PosStoreProvider>;
}
