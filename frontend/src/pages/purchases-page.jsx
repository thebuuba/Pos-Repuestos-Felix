// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { usePosStore } from "../data/pos-context.jsx";
import { balanceOf } from "../lib/accounts.js";
import { businessMonthIso } from "../lib/dates.js";
import { PageHeader } from "../components/pos/page-header.jsx";
import { MiniStat } from "../components/pos/section-card.jsx";
import { Calendar } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { Receipt } from "lucide-react";
import { Truck } from "lucide-react";
import { Package } from "lucide-react";
import { PurchaseEntryForm } from "../components/pos/purchase-entry-form.jsx";
import { toast as ue } from "sonner";
import { PurchasesHistoryTable } from "../components/pos/purchases-history-table.jsx";
import { cents, decimalUnits } from "../../../src/pos/operation-fields.js";
import { needsRestock } from "../components/pos/inventory-table.jsx";

function PurchasesPage() {
  const [params] = useSearchParams();
  const initialSupplierId = params.get("suplidor") ?? "";
  const {
    suppliers,
    formulas,
    products,
    purchases,
    payables,
    settings,
    registerPurchase,
    voidPurchase,
    runtime,
  } = usePosStore();
  const { monthCount, monthTotal } = useMemo(() => {
    const month = businessMonthIso();
    let count = 0;
    let sum = 0n;
    for (let i = 0; i < purchases.length; i++) {
      const p = purchases[i];
      if (p.status === "anulada") continue;
      const pMonth = p.date.length === 10 ? p.date.slice(0, 7) : businessMonthIso(new Date(p.date));
      if (pMonth === month) {
        count++;
        sum += cents(p.total);
      }
    }
    return { monthCount: count, monthTotal: decimalUnits(sum, 2) };
  }, [purchases]);
  const owed = useMemo(() => payables?.reduce((s, p) => s + balanceOf(p), 0) ?? 0, [payables]);
  const restockCount = useMemo(() => {
    let n = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (runtime ? needsRestock(p) : p.stock <= p.minStock) n++;
    }
    return n;
  }, [products, runtime]);
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
          hint={`${monthCount} facturas`}
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
          value={restockCount}
          hint="Artículos bajo el mínimo"
        />
      </div>
      <PurchaseEntryForm
        suppliers={suppliers}
        formulas={formulas}
        products={products}
        rounding={settings.rounding}
        runtime={runtime}
        initialSupplierId={initialSupplierId}
        onSubmit={async (input) => {
          const result = await registerPurchase(input);
          const purchase = runtime ? result.state.compras.find(row => row.id === result.result.id) : result;
          ue.success(`Compra ${runtime ? purchase.numero : purchase.number} subida al inventario`, {
            description: `${input.lines.length} artículos · ${formatMoney(purchase.total)}`,
          });
        }}
      />
      <PurchasesHistoryTable
        purchases={purchases}
        suppliers={suppliers}
        business={settings.business}
        canVoid={Boolean(runtime?.isOwner && voidPurchase)}
        onVoidPurchase={voidPurchase ? async (purchase, reason, retryAction) => {
          if (retryAction) await retryAction();
          else await voidPurchase({
            databaseId: purchase.databaseId,
            purchaseId: purchase.id,
            version: purchase.version,
            reason,
          });
          ue.success(`Compra ${purchase.supplierInvoice || purchase.number} anulada`, {
            description: "Se revirtió el inventario y se liberó el número de factura.",
          });
        } : undefined}
      />
    </div>
  );
}
export { PurchasesPage };
