// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/page-header.jsx";
import { AccountsView } from "../components/accounts-view.jsx";
function ReceivablesPage() {
  const { runtime, receivables, customers, sales, payReceivable } = usePosStore();
  const debts = runtime ? sales.filter(s => s.condition === 'credito').map(s => ({
    id:s.id, partyId:s.customerId, document:s.number, date:s.date, dueDate:null, amount:s.total, paid:0,
  })) : receivables;
  const [params] = useSearchParams();
  const initial = params.get("cliente") ?? undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x cobrar"
        description={runtime ? "Ventas a crédito registradas en el POS. Los saldos históricos de NetPOS requieren conciliación." : "Facturas a crédito de tus clientes. Los cobros en efectivo entran solos a la caja."}
      />
      <AccountsView
        docs={debts}
        parties={customers.filter((c) => runtime ? !c.isCashCustomer : c.id !== "c-000")}
        partyLabel="Cliente"
        verb="Cobrar"
        initialPartyId={initial}
        onPay={payReceivable}
        readOnly={!!runtime}
        key={initial ?? "all"}
      />
    </div>
  );
}
export { ReceivablesPage };
