// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { balanceOf } from "../lib/accounts.js";
import { PageHeader } from "../components/page-header.jsx";
import { MiniStat } from "../components/section-card.jsx";
import { Calendar } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { Receipt } from "lucide-react";
import { Truck } from "lucide-react";
import { Package } from "lucide-react";
import { PurchaseEntryForm } from "../components/purchase-entry-form.jsx";
import { toast as ue } from "sonner";
import { PurchasesHistoryTable } from "../components/purchases-history-table.jsx";
function PurchasesPage() {
  const {
    suppliers,
    formulas,
    products,
    purchases,
    payables,
    settings,
    registerPurchase,
  } = usePosStore();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthPurchases = purchases.filter(
    (p) => new Date(p.date) >= monthStart,
  );
  const monthTotal = monthPurchases.reduce((s, p) => s + p.total, 0);
  const owed = payables.reduce((s, p) => s + balanceOf(p), 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Subir factura de compra"
        description="Entrada de mercancía: suma existencias y actualiza costos y precios en un paso."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          icon={Calendar}
          tone="primary"
          label="Compras del mes"
          value={formatMoney(monthTotal)}
          hint={`${monthPurchases.length} facturas`}
        />
        <MiniStat
          icon={Receipt}
          label="Pendiente a suplidores"
          value={formatMoney(owed)}
          hint="Ver Cuentas x pagar"
        />
        <MiniStat
          icon={Truck}
          label="Suplidores activos"
          value={suppliers.length}
        />
        <MiniStat
          icon={Package}
          tone="warning"
          label="Por reponer"
          value={products.filter((p) => p.stock <= p.minStock).length}
          hint="Artículos bajo el mínimo"
        />
      </div>
      <PurchaseEntryForm
        suppliers={suppliers}
        formulas={formulas}
        products={products}
        rounding={settings.rounding}
        onSubmit={(input) => {
          const purchase = registerPurchase(input);
          ue.success(`Compra ${purchase.number} subida al inventario`, {
            description: `${input.lines.length} artículos · ${formatMoney(purchase.total)}`,
          });
        }}
      />
      <PurchasesHistoryTable purchases={purchases} suppliers={suppliers} />
    </div>
  );
}
export { PurchasesPage };
