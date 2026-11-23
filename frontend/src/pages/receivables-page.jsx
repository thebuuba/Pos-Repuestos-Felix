// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/pos/page-header.jsx";
import { AccountsView } from "../components/pos/accounts-view.jsx";
function ReceivablesPage() {
  const { runtime, receivables, customers, cashSession, payReceivable, recordReceivablePayment } = usePosStore();
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
    </div>
  );
}
export { ReceivablesPage };
