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
import { cents, decimalUnits } from "../../../../src/pos/operation-fields.js";
import { needsRestock } from "../components/inventory-table.jsx";

const businessMonth = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit",
});
function PurchasesPage() {
  const {
    suppliers,
    formulas,
    products,
    purchases,
    payables,
    settings,
    registerPurchase,
    runtime,
  } = usePosStore();
  const month = businessMonth.format(new Date());
  const monthPurchases = purchases.filter(p =>
    (p.date.length === 10 ? p.date.slice(0, 7) : businessMonth.format(new Date(p.date))) === month);
  const monthTotal = decimalUnits(monthPurchases.reduce((sum, p) => sum + cents(p.total), 0n), 2);
  const owed = payables?.reduce((s, p) => s + balanceOf(p), 0);
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
          value={runtime ? "—" : formatMoney(owed)}
          hint={runtime ? "Saldo no disponible" : "Ver Cuentas x pagar"}
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
          value={products.filter(runtime ? needsRestock : p => p.stock <= p.minStock).length}
          hint="Artículos bajo el mínimo"
        />
      </div>
      <PurchaseEntryForm
        suppliers={suppliers}
        formulas={formulas}
        products={products}
        rounding={settings.rounding}
        runtime={runtime}
        onSubmit={async (input) => {
          const result = await registerPurchase(input);
          const purchase = runtime ? result.state.compras.find(row => row.id === result.result.id) : result;
          ue.success(`Compra ${runtime ? purchase.numero : purchase.number} subida al inventario`, {
            description: `${input.lines.length} artículos · ${formatMoney(purchase.total)}`,
          });
        }}
      />
      <PurchasesHistoryTable purchases={purchases} suppliers={suppliers} />
    </div>
  );
}
export { PurchasesPage };
