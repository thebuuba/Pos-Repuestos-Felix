// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-store.jsx";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/page-header.jsx";
import { AccountsView } from "../components/accounts-view.jsx";
function ReceivablesPage() {
  const { receivables, customers, payReceivable } = usePosStore();
  const [params] = useSearchParams();
  const initial = params.get("cliente") ?? undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x cobrar"
        description="Facturas a crédito de tus clientes. Los cobros en efectivo entran solos a la caja."
      />
      <AccountsView
        docs={receivables}
        parties={customers.filter((c) => c.id !== "c-000")}
        partyLabel="Cliente"
        verb="Cobrar"
        initialPartyId={initial}
        onPay={payReceivable}
        key={initial ?? "all"}
      />
    </div>
  );
}
export { ReceivablesPage };
