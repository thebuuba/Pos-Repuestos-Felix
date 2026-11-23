// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePosStore } from "../data/pos-context.jsx";
import { PageHeader } from "../components/pos/page-header.jsx";
import { AccountsView } from "../components/pos/accounts-view.jsx";
import { PurchaseInvoiceDialog } from "../components/pos/purchase-invoice-dialog.jsx";
import { toast as ue } from "sonner";
function PayablesPage() {
  const {
    runtime,
    purchases,
    payables,
    suppliers,
    settings,
    cashSession,
    payPayable,
    recordPayablePayment,
    voidPurchase,
  } = usePosStore();
  const [selectedPurchaseId, setSelectedPurchaseId] = useState(null);
  const [params] = useSearchParams();
  const initial = params.get("suplidor") ?? undefined;
  const selectedPurchase = selectedPurchaseId != null
    ? (purchases.find((p) => p.id === selectedPurchaseId) ?? null)
    : null;
  const selectedSupplier = selectedPurchase
    ? suppliers.find((s) => s.id === selectedPurchase.supplierId)
    : undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x pagar"
        description="Facturas de compra a crédito con tus suplidores. Los pagos en efectivo salen de la caja abierta; haz clic en la factura o en Abonado para ver el detalle."
      />
      <AccountsView
        docs={payables}
        parties={suppliers}
        partyLabel="Suplidor"
        verb="Pagar"
        initialPartyId={initial}
        operational={Boolean(runtime)}
        cashOpen={Boolean(cashSession?.open)}
        business={settings.business}
        printFormat={settings.printFormat}
        ticketFooter={settings.ticketFooter}
        onViewDocument={(doc) => {
          const found = purchases.find((p) => p.id === doc.id);
          if (found) setSelectedPurchaseId(found.id);
        }}
        onPay={async (doc, amount, method, note) => {
          if (runtime) {
            await recordPayablePayment({
              databaseId: doc.databaseId,
              purchaseId: doc.id,
              version: doc.version,
              amount,
              method,
              cashSessionId: method === "efectivo" ? cashSession?.id : undefined,
              note: note ?? "",
            });
          } else {
            await payPayable(doc.id, amount, method, note);
          }
        }}
        key={initial ?? "all"}
      />
      <PurchaseInvoiceDialog
        purchase={selectedPurchase}
        supplier={selectedSupplier}
        business={settings.business}
        open={Boolean(selectedPurchase)}
        onOpenChange={(open) => { if (!open) setSelectedPurchaseId(null); }}
        canVoid={Boolean(runtime?.isOwner)}
        onVoid={async (purchase, reason) => {
          await voidPurchase({
            databaseId: purchase.databaseId,
            purchaseId: purchase.id,
            version: purchase.version,
            reason,
          });
          ue.success(`Compra ${purchase.supplierInvoice || purchase.number} anulada`);
          setSelectedPurchaseId(null);
        }}
      />
    </div>
  );
}
export { PayablesPage };
