// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useState } from "react";
import { usePosStore } from "../data/pos-context.jsx";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/pos/page-header.jsx";
import { AccountsView } from "../components/pos/accounts-view.jsx";
import { ReceiptDialog } from "../components/pos/receipt-dialog.jsx";
import { receiptFromStoredSale } from "../data/operational-sales.js";
function ReceivablesPage() {
  const { runtime, sales, receivables, customers, settings, cashSession, payReceivable, recordReceivablePayment } = usePosStore();
  const [reprintSale, setReprintSale] = useState(null);
  const [params] = useSearchParams();
  const initial = params.get("cliente") ?? undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x cobrar"
        description={
          runtime
            ? "Facturas a crédito de tus clientes. Los cobros en efectivo entran solos a la caja abierta; los saldos históricos de apertura se consultan en Clientes."
            : "Facturas a crédito de tus clientes. Los cobros en efectivo entran solos a la caja."
        }
      />
      <AccountsView
        docs={receivables}
        parties={customers.filter((c) => (runtime ? !c.isCashCustomer : c.id !== "c-000"))}
        partyLabel="Cliente"
        verb="Cobrar"
        initialPartyId={initial}
        operational={Boolean(runtime)}
        cashOpen={Boolean(cashSession?.open)}
        onViewDocument={(doc) => {
          const found = sales.find((s) => s.id === doc.id);
          if (found) setReprintSale(found);
        }}
        onPay={async (doc, amount, method, note) => {
          if (runtime) {
            await recordReceivablePayment({
              databaseId: doc.databaseId,
              saleId: doc.id,
              version: doc.version,
              amount,
              method,
              cashSessionId: method === "efectivo" ? cashSession?.id : undefined,
              note: note ?? "",
            });
          } else {
            await payReceivable(doc.id, amount, method, note);
          }
        }}
        key={initial ?? "all"}
      />
      <ReceiptDialog
        sale={receiptFromStoredSale(reprintSale)}
        open={Boolean(reprintSale)}
        onOpenChange={(open) => { if (!open) setReprintSale(null); }}
        onNewSale={() => setReprintSale(null)}
        business={settings.business}
        printFormat={settings.printFormat}
        footer={settings.ticketFooter}
        isReprint
      />
    </div>
  );
}
export { ReceivablesPage };
