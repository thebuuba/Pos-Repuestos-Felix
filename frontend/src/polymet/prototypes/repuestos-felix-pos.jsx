// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { PosLayout } from "../layouts/pos-layout.jsx";
import { PosStoreProvider } from "../data/pos-store.jsx";
import { BrowserRouter } from "react-router-dom";
import { Routes } from "react-router-dom";
import { Route } from "react-router-dom";
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
import { ModulePlaceholderPage } from "../pages/module-placeholder-page.jsx";
import { Toaster } from "../../components/ui/sonner.jsx";
var withLayout = (page) => <PosLayout>{page}</PosLayout>;
function RepuestosFelixPos() {
  return (
    <PosStoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={withLayout(<DashboardPage />)} />
          <Route path="/ventas" element={withLayout(<PointOfSalePage />)} />
          <Route path="/inventario" element={withLayout(<InventoryPage />)} />
          <Route path="/compras" element={withLayout(<PurchasesPage />)} />
          <Route path="/caja" element={withLayout(<CashRegisterPage />)} />
          <Route path="/clientes" element={withLayout(<CustomersPage />)} />
          <Route path="/suplidores" element={withLayout(<SuppliersPage />)} />
          <Route path="/reportes" element={withLayout(<ReportsPage />)} />
          <Route
            path="/cuentas-por-cobrar"
            element={withLayout(<ReceivablesPage />)}
          />
          <Route
            path="/cuentas-por-pagar"
            element={withLayout(<PayablesPage />)}
          />
          <Route path="/configuracion" element={withLayout(<SettingsPage />)} />
          <Route path="/ayuda" element={withLayout(<HelpPage />)} />
          <Route path="*" element={withLayout(<ModulePlaceholderPage />)} />
        </Routes>
        <Toaster position="top-center" richColors={true} />
      </BrowserRouter>
    </PosStoreProvider>
  );
}
export { RepuestosFelixPos };
