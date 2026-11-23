// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { PageHeader } from "../components/page-header.jsx";
import { AccountsView } from "../components/accounts-view.jsx";
function PayablesPage() {
  const { runtime, payables, suppliers, cashSession, payPayable, recordPayablePayment } = usePosStore();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x pagar"
        description="Facturas de compra a crédito con tus suplidores. Los pagos en efectivo salen de la caja abierta."
      />
      <AccountsView
        docs={payables}
        parties={suppliers}
        partyLabel="Suplidor"
        verb="Pagar"
        operational={Boolean(runtime)}
        cashOpen={Boolean(cashSession?.open)}
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
      />
    </div>
  );
}
export { PayablesPage };
